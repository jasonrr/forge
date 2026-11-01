#!/usr/bin/env bash
# Ship forge: test, bump the version in the Claude, Codex and pi manifests, commit, tag,
# push to main, then refresh the local Claude Code and Codex installs.
# Usage: scripts/publish.sh [patch|minor|major|X.Y.Z]   (default: patch)
set -euo pipefail
cd "$(dirname "$0")/.."
die() { echo "publish: $*" >&2; exit 1; }

[ "$(git branch --show-current)" = main ] || die "not on main"
[ -z "$(git status --porcelain)" ] || die "working tree not clean"
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not at origin/main; pull or push first"

cur=$(jq -r .version .claude-plugin/plugin.json)
[ "$cur" = "$(jq -r .version .codex-plugin/plugin.json)" ] || die "plugin.json ($cur) and .codex-plugin/plugin.json versions differ"
[ "$cur" = "$(jq -r .version package.json)" ] || die "plugin.json ($cur) and package.json versions differ"
IFS=. read -r ma mi pa <<<"$cur"
case "${1:-patch}" in
  patch) new="$ma.$mi.$((pa + 1))" ;;
  minor) new="$ma.$((mi + 1)).0" ;;
  major) new="$((ma + 1)).0.0" ;;
  *)     [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: $0 [patch|minor|major|X.Y.Z]"; new="$1" ;;
esac
! git rev-parse -q --verify "refs/tags/v$new" >/dev/null || die "tag v$new already exists"

bash hooks/session-start.test.sh
node --experimental-strip-types --no-warnings --input-type=module -e 'await import(new URL("pi/extensions/routing.ts", "file://" + process.cwd() + "/"))'

# perl, not sed -i: same syntax on macOS and Linux; keeps the files' formatting.
perl -pi -e "s/\"version\": \"\Q$cur\E\"/\"version\": \"$new\"/" .claude-plugin/plugin.json .codex-plugin/plugin.json package.json
[ "$(jq -r .version .claude-plugin/plugin.json)$(jq -r .version .codex-plugin/plugin.json)$(jq -r .version package.json)" = "$new$new$new" ] || die "version bump failed"

git commit -q -m "Release v$new" -- .claude-plugin/plugin.json .codex-plugin/plugin.json package.json
git tag -a "v$new" -m "v$new"
git push -q --follow-tags origin main
echo "publish: pushed v$new"

if command -v claude >/dev/null; then
  claude plugin marketplace update forge && claude plugin update forge@forge \
    && echo "publish: local install updated — run /reload-plugins (or restart) to load it"
else
  echo "publish: no claude CLI here; run: claude plugin marketplace update forge && claude plugin update forge@forge"
fi
if command -v codex >/dev/null && codex plugin list 2>/dev/null | grep -Eq '^forge@forge[[:space:]]+installed'; then
  src=$(codex plugin marketplace list --json 2>/dev/null | jq -r '.marketplaces[] | select(.name == "forge") | .marketplaceSource.sourceType' 2>/dev/null || true)
  { [ "$src" != git ] || codex plugin marketplace upgrade forge; } && codex plugin add forge@forge >/dev/null \
    && echo "publish: Codex install updated — restart Codex to load it" \
    || echo "publish: Codex refresh failed; run: codex plugin marketplace upgrade forge && codex plugin add forge@forge"
fi

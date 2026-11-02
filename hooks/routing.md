<dev-loop>
This project uses the dev loop. Standing routing — the human should never have to ask:
- Feature or non-trivial change requested → run /forge:brainstorm before writing any code.
- Bug, failing test, or unexpected behavior → run /forge:debug before proposing any fix.
- Approved design (an uncommitted docs/decisions/*.md) or any multi-step implementation → run /forge:plan before building.
- A plan file (docs/plans/*.md) named in your brief, or one with an open draft PR → execute it with /forge:build.
- Branch complete, or a merge/PR is requested → run /forge:review-branch first.
- An issue number, issue URL, or "start work on …" with no design yet → run /forge:start; it routes to debug, brainstorm, plan or build by reading.
Trivial one-file changes and pure questions are exempt. When this rule triggers a skill, say so in one line.
</dev-loop>

// Run by path through the ~/.claude/skills/forge-show link. Node resolves this file's real place first,
// so the import below reaches the checkout's show tool whatever folder the bot is working in.
import { main } from '../../show/show.mjs'
await main(['page', ...process.argv.slice(2)])

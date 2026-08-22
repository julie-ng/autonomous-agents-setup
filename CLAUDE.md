# CLAUDE.md

## About this repo

- Design notes for an autonomous-agent setup. Documentation, not an app.
- Mostly markdown. Some Dockerfiles and diagrams later.
- Work-in-progress. Contents change constantly — optimize for fast scanning.
- `architecture/` holds design docs, one topic per file.
- **The docs are the memory.** If it matters and isn't written down, it didn't happen. Err toward writing it down.

## Writing style

- Be succinct. Load-bearing information only. No fluff.
- Full sentences not required. Prefer bullets.
- Keep tables succinct — short cells, no repeated phrasing across columns.
- Drop a row/column that says the same thing in every cell.
- No preamble, no summary-of-what-you-just-read sections.
- Link out instead of restating external docs.
- Use `> [!NOTE]` / `> [!IMPORTANT]` for callouts.
- `<details>` for reference material that isn't read every time.

## Security framing

- **Config != boundary.** A mitigation is not a guarantee. Never round one up to the other for a cleaner sentence.
- Only OS-level mechanisms (container, VM, restricted user) claim "boundary." `settings.json` rules match command strings, not resolved paths — deterrent only.
- Before writing "this protects X," ask whether it protects X or merely discourages something.

## Two layers, never conflated

1. **Isolation** — microVMs, dev containers. Must hold under scrutiny.
2. **Convenience** — session managers, dashboards, worktree UIs. Zero authority to claim isolation it doesn't enforce.

When evaluating a tool, name which layer it operates at. A good answer at layer 2 buys no credibility at layer 1. Flag category errors plainly — don't soften them into "a consideration."

## Accuracy

- Don't invent technical claims to fill a table cell.
- **Mark unverified claims in the file itself**, not just in chat — otherwise they become settled fact next session.
- Explicit over implicit: give the mechanism, not "it's handled."
- Ask who else writes a shared resource before concurrency bites. (`~/.claude.json` corruption is the formative example.)
- These notes justify a security boundary — wrong details are load-bearing.

## Decisions

- Every doc tracking an evolving design gets a decision log: date/context → decision, one row each.
- Write tradeoffs down even once decided — including minor ones. Decisions with the reasoning stripped out are useless later.
- Trust-tier sources: primary/authoritative vs. secondary vs. don't-cite.

## Spikes

- Narrow, stated question — "does *this specific mechanism* work," not "does this work."
- Go/no-go criteria fixed before running, not vibes after.
- Layered: each layer gets its own go/no-go. Don't bundle steps where a failure would be ambiguous about which part broke.
- Partial success is kept. Layer 2 failing doesn't invalidate Layer 1.
- Update the decision log as you go, not at the end.

## Goals vs. current state

"Goals" are targets, not achieved state. Don't flag the gap between a goal and the documented current setup as a contradiction — the gap is the work.

# AGENTS.md

Rules for any agent working in this repo, regardless of harness or model.

> [!NOTE]
> **This is the single source of truth.** [CLAUDE.md](./CLAUDE.md) is a stub
> that imports this file via `@AGENTS.md`. Harness-agnostic by design — the repo
> is tested against goose and multiple model providers, so rules live here and
> only Claude-Code-specific additions belong in CLAUDE.md.

## About this repo

- Design notes for an autonomous-agent setup. **Documentation, not an app.**
- Mostly markdown. Some Dockerfiles and diagrams.
- Work-in-progress — contents change constantly. Optimize for fast scanning.
- `architecture/` holds design docs, one topic per file. `spikes/` holds
  narrow experiments.
- **The docs are the memory.** If it matters and isn't written down, it didn't
  happen. Err toward writing it down.

## Verify, don't guess

- Never state a technical claim you have not checked. Read the file, run the
  command, fetch the doc.
- **Mark unverified claims in the file itself**, not just in chat — otherwise
  they become settled fact next session.
- Give the mechanism, not "it's handled."
- Don't invent detail to fill a table cell. An empty cell is honest; a
  plausible guess is not.
- Prefer primary sources. Note the trust tier when it's not obvious:
  primary/authoritative vs. secondary vs. don't-cite.
- Ask who else writes a shared resource before concurrency bites.
- **These notes justify a security boundary — wrong details are load-bearing.**

## Security framing

- **Config != boundary.** A mitigation is not a guarantee. Never round one up
  to the other for a cleaner sentence.
- Only OS-level mechanisms (container, VM, restricted user) claim "boundary."
  Config-file rules that match command strings are deterrents, not boundaries.
- Before writing "this protects X," ask whether it protects X or merely
  discourages something.

### Two layers, never conflated

1. **Isolation** — microVMs, containers. Must hold under scrutiny.
2. **Convenience** — session managers, dashboards, worktree UIs. Zero
   authority to claim isolation it doesn't enforce.

Name which layer a tool operates at. A good answer at layer 2 buys no
credibility at layer 1. Flag category errors plainly.

## Writing style

- Succinct. Load-bearing information only. No fluff.
- Full sentences not required. Prefer bullets.
- Keep tables succinct. Drop a row/column that says the same thing in every cell.
- No preamble, no summary-of-what-you-just-read sections.
- Link out instead of restating external docs.
- `> [!NOTE]` / `> [!IMPORTANT]` for callouts. `<details>` for reference
  material not read every time.
- No hard line breaks mid-paragraph.

## Decisions

- Every doc tracking an evolving design gets a decision log: date/context →
  decision, one row each.
- Write tradeoffs down even once decided — including minor ones. Decisions with
  the reasoning stripped out are useless later.
- **Don't carry forward unevaluated choices.** If a tool or pattern was
  inherited rather than chosen, say so rather than presenting it as settled.

## Spikes

- Narrow, stated question — "does *this specific mechanism* work," not "does
  this work."
- Go/no-go criteria fixed before running, not vibes after.
- Layered: each layer gets its own go/no-go. Don't bundle steps where a failure
  would be ambiguous about which part broke.
- Partial success is kept. Layer 2 failing doesn't invalidate Layer 1.
- Update the decision log as you go, not at the end.

## Goals vs. current state

"Goals" are targets, not achieved state. Don't flag the gap between a goal and
the documented current setup as a contradiction — **the gap is the work.**

## Communication

- Lead with the correction, not a re-derivation of the whole model.
- Don't recap tool calls the user just watched execute.
- Report failures plainly, with the actual output.
- Flag adjacent problems found along the way; do not fix them unasked.
- Say explicitly what was left out and why.
- Check whether the answer is already in the repo before asking.

## Changes

- Ask before destructive or hard-to-reverse actions.
- Commit or push only when asked.
- Never commit secrets, tokens, or keys. Provider keys arrive at runtime.

# AGENTS.md

Sample project-level agent rules, mounted into the container as the repo's
`AGENTS.md` for testing.

> [!NOTE]
> **This is test fixture, not policy for this repo.** Adapted from a real Nuxt 4
> project (`tally-split-ai`) so the agent has something more demanding than a
> hello-world to work against — real conventions, real anti-patterns, real
> "check the docs before designing" pressure.
>
> Harness-agnostic on purpose: the same file is used to test goose across
> multiple model providers. Nothing here assumes a specific agent.

## Context

- Current year: 2026

## Documentation sources (verify, don't guess)

Do NOT design from training data for fast-moving products. Consult the
authoritative source before implementing:

| Topic | Source |
|:--|:--|
| Nuxt / Nuxt UI | Nuxt MCP server if connected, else current Nuxt docs |
| Supabase | Current Supabase docs — JWT/RLS/Realtime behavior has changed |
| Everything else | Fetch the library's own current docs |

Training-data assumptions have been wrong here before. Check first.

## Project overview

Nuxt 4 full-stack app for analyzing scanned receipts with handwritten
annotations to split expenses. Azure Document Intelligence does OCR; LLMs
detect handwritten annotations (initials, circles, strikethroughs).

- **Framework** — Nuxt 4, hybrid SSR
- **Database** — PostgreSQL 17 + Drizzle ORM
- **Storage** — Azure Blob Storage, direct client uploads via SAS tokens
- **Workflows** — Trigger.dev, fixed 5-step pipeline
- **Frontend** — Vue 3, Pinia, NuxtUI, Tailwind
- **Testing** — Vitest; unit tests co-located, integration in `tests/`
- **Language** — JavaScript (TypeScript for schema, connection, trigger tasks)

Deterministic control flow. LLMs are perception/extraction components, **not
agents**. Only OCR is fatal; AI steps degrade gracefully.

## Key principles

- **Zod schemas are the single source of truth** — validation for both
  frontend and backend. Distinguish request schemas (HTTP input) from insert
  schemas (DB writes).
- **All Azure SDK usage is server-side only** — access keys must never reach
  the client.
- **Explicit utility functions over middleware** — call
  `guards.requireAuthentication(event)` at the top of each handler.
- **Use `createError()` over `new Error()`** in Nuxt API handlers. Plain
  `Error` in server utils and trigger tasks, which run outside Nuxt.
- **Stores must not reference each other** — keep Pinia stores independent.
- **Trigger tasks import directly** — they run outside Nuxt and cannot use
  auto-imports.

## Anti-patterns

**Never hand-roll validation.** It duplicates schema logic and drifts:

```js
// ❌ DO NOT
if (title !== undefined && typeof title === 'string') { updates.title = title }

// ✅ DO
const result = await readValidatedBody(event, body =>
  zodSchemas.uploadUpdateSchema.safeParse(body))
```

**Never hardcode status strings.** Enums in `shared/enums/` are the source of
truth:

```js
if (workflow.status === 'failed') { }                      // ❌
if (workflow.status === WORKFLOW_STATUS.FAILED) { }        // ✅
```

**Never alias store ComputedRefs** — it snapshots and breaks reactivity:

```js
const displayName = userStore.displayName  // ❌ won't update
```

## Code style

ESLint via the Nuxt ESLint module with `@stylistic`. See `eslint.config.mjs`.

- No semicolons. Trailing commas required.
- Always brace `if`/`else` — no single-line bodies.
- Subpath imports across boundaries: `#shared/*`, `#server/*` — never `~~/`.
- Utility files: `.utils.js`, tests `.utils.test.js`. Generate tests wherever
  possible.

| Location | Purpose |
|:--|:--|
| `app/utils/` | Frontend-only |
| `server/utils/` | Backend-only |
| `shared/utils/` | Both client and server |

### Comments

- No comments on self-explanatory code.
- Never strip existing JSDoc when refactoring — ask if a comment seems stale.
- Reserve `IMPORTANT` for **load-bearing** facts: a deliberate omission that
  reads as an oversight, a value that looks safe to "fix". Overuse makes it
  invisible.
- When a **deliberate omission** is the enforcement mechanism, assert it in a
  test too — a comment can be ignored, a failing test cannot.

## Communication

- **Avoid serializing small decisions.** If the answer is in the code, act and
  state the assumption in one line.
- Never re-ask something already answered.
- Batch genuinely-open decisions into one question.
- Lead with the correction itself. One line for what changed, then the
  consequence. Don't tally past mistakes or over-apologise.
- Don't recap tool calls the user just watched execute. State the outcome and
  what is still open.
- Report failures plainly, with the output.
- Flag adjacent problems; do not fix them unasked. Say what was left out.

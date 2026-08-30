# Spike: goose in a container, driven over ACP

**Question:** can a controller spawn `goose acp` as a child process inside a container, talk to it over ACP, and have it run against an API-key provider — no Claude subscription, no interactive setup?

**Status:** ✅ Done, 30 Aug 2026. Not being developed further — kept as a reference.

## What's here

| | |
|---|---|
| `Dockerfile` | `goose-in-a-box`. See [containerizing-goose.md](../containerizing-goose.md) for the gotchas. |
| `goose.config.yaml` | Baked provider config. Vercel AI Gateway → `openai/gpt-5-mini`. |
| `goose-acp-client.ts` | Minimal ACP client. Spawns `goose acp`, handshake, one prompt, prints updates. |

## Run it

```sh
docker build -t goose-in-a-box .
docker run -it -e AI_GATEWAY_API_KEY="$AI_GATEWAY_API_KEY" goose-in-a-box
```

Then inside:

```sh
npx tsx goose-acp-client.ts
```

## Result

✅ Connected to goose (protocol v1) → session created → prompt sent → tool call completed → `stop_reason: end_turn`.

Confirmed:

- goose runs headless in a container. Zero interactive prompts.
- ACP works in-container. No `claude-agent-acp` wrapper — `goose acp` is the goose binary.
- **Not** piggybacking on my Claude subscription. Spend landed on the Vercel AI Gateway key, `openai/gpt-5-mini` as specified. No Anthropic credentials in the image.
- `GOOSE_PROVIDER` env overrides baked `active_provider`, as goose's docs say. (A prior host-side session concluded the opposite; never root-caused, doesn't reproduce in a container.)

## Known-incomplete

The client stubs the filesystem — `readTextFile` returns `"Mock file content"`, `writeTextFile` is a no-op. Fine for proving the handshake. Must be real before a controller drives actual work.

## Where this goes next

Phase 1 uses `goose run --text "$PROMPT"` — fire-and-die, no ACP client needed. This spike proves ACP is available for when a controller needs streaming progress, permission prompts, or mid-task intervention.

See [orhcestration-k8s-phase-1.md](../../architecture/orhcestration-k8s-phase-1.md).

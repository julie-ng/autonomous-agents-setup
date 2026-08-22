# Research sources: plan mode, subagents, worktrees & multi-agent Claude Code workflows
 
For: plan → subagent → worktree → bot-account push → GitHub-review pipeline
 
---
 
## 1. Primary (Anthropic) — read first
 
- **[Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)**
  - foundational doc, everything else cites it
  - plan mode, subagent basics, CLAUDE.md, verification loops, checkpointing
  - if only reading one thing → this one
- **[How Claude Code works in large codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)**
  - "Claude Code at scale" series, newer
  - enterprise/monorepo focus — closest to your actual use case
  - worktree-based parallel work, org-level conventions
- **[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)**
  - the *why* behind subagents — context window limits, "just-in-time" loading
  - explains why subagent returns condensed summary, not full trace
- **[code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)**
  - living reference docs, not a blog post — most current
  - worktree isolation flags (`isolation: worktree`)
  - fork mode, nested subagent spawning (v2.1.172+)
  - `.claude/agents/` frontmatter format
- **[anthropic.com/engineering](https://www.anthropic.com/engineering)**
  - index of all Anthropic eng posts — bookmark, recheck periodically
---
 
## 2. Independent engineering writers — reputable, sometimes dissenting
 
- **[How Claude Code is built](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built)** — Gergely Orosz / Pragmatic Engineer
  - NOT a how-to — how Anthropic's own team uses subagents internally
  - subagent feature build history (3 days, 2 days thrown away)
  - AI-driven code review, TDD renaissance at Anthropic — relevant to your review-gate design
  - also: source of the Claude Code vs Cursor "most loved" dev survey stat (46% vs 19%) — search their archive for the primary writeup
- **[Simon Willison's newsletter](https://simonw.substack.com/)**
  - cross-vendor, not Anthropic-only — good for "is this Claude-specific or industry-wide"
  - [Codex subagents piece](https://simonw.substack.com/p/fireside-chat-about-agentic-engineering): OpenAI converged on nearly identical explorer/worker/default model
- **[sankalp's blog — Claude Code 2.0 guide](https://sankalp.bearblog.dev/my-experience-with-claude-code-20-and-how-to-get-better-at-using-coding-agents/)**
  - personal but detailed, willing to disagree with consensus
  - **dissents**: rarely uses Plan Mode, prefers exploring codebase himself first
  - real multi-tool workflow: Claude Code (driver) + Codex (review) + Cursor (manual edits)
---
 
## 3. Community-curated aggregations — secondary but well-sourced
 
- **[shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice)** (GitHub, #1 Trending Mar 2026)
  - 69 tips / 11 categories, input from **Boris Cherny** (built Claude Code at Anthropic)
  - most-cited community consolidation as of mid-2026
  - tactical: `/compact` vs `/clear`, `.claude/commands/` structure, subagent persona design, tmux+worktree agent-teams pattern
- **[rosmur.github.io/claudecode-best-practices](https://rosmur.github.io/claudecode-best-practices/)**
  - explicit methodology: synthesis of 12 sources (personal + official + community)
  - distilled consensus check — 3 headline takeaways, good sanity check against over-engineering
---
 
## 4. Landscape / comparison pieces — lower weight on methodology
 
- **[State of CLI Coding Agents, Mid-2026](https://blog.arcbjorn.com/state-of-cli-coding-agents-2026)**
  - cross-tool survey — what's Claude-specific vs. category table-stakes
  - notes architectural fork: Claude Code/Amp = agents coordinate as peers; Codex/Copilot = push parallelism to cloud
- **[OpenCode vs Claude Code, Aug 2026](https://www.morphllm.com/comparisons/opencode-vs-claude-code)**
  - `/goal` command detail — validator model checks completion every step
  - adoption stat: Claude Code 10%+ of public GitHub commits
- **[Cursor Agent Mode vs Claude Code 2026](https://www.futureproofing.dev/resources/ai-native-team/claude-code-vs-cursor-agent-mode-2026)**
  - frames skill as "right autonomy model per task," not tool loyalty
  - directly relevant to your Zed-pairing vs. CLI-autonomous split
---
 
## 5. Lower confidence — don't cite directly
 
- smartscope.blog, mcp.directory, teamday.ai, axify.io, explainx.ai, aiagenteconomy.substack.com, skillsplayground.com
- likely SEO/content-farm restatements of primary sources
- skillsplayground.com = fine for ideas, verify anything load-bearing elsewhere
---
 
## Gaps — not covered by this pass
 
- **AI Engineer / swyx / Latent Space** — no direct hit on this specific topic; conference-talk-heavy content, check channel/site directly
- **Codex / Gemini CLI equivalents** — this pass was Claude Code-only

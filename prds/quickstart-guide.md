# PRD: Quick Start & Step-by-Step Guide

## Problem Statement

A developer who discovers `see-crets` faces two sequential challenges:

1. **Evaluation friction**: The README explains *what* see-crets does well, but a developer evaluating it cannot quickly answer "will this work with my Node.js project?" without reading several sections and piecing together the flow themselves.

2. **Onboarding friction**: A developer who is convinced and ready to install it must follow a multi-section, multi-tier setup flow that shows platform-specific steps in parallel tables rather than a single linear narrative. There is no end-to-end journey that shows the payoff — a secret stored, used in a real call, scrubbed from AI output, then rotated safely.

The result: developers either bounce before grasping the value, or install only part of the system and miss the scrubbing/rotation features that differentiate see-crets from `.env` management.

---

## Solution

Add a new **"Walkthrough"** section to `README.md` immediately after the existing Quick Start section. The walkthrough uses a concrete running example — a Node.js web app — to guide the reader from zero to a fully protected project in a single linear narrative.

The guide covers two starting points in sequence:
1. **Fresh project** — store a new secret, use it in a tool call, see it scrubbed, rotate it.
2. **Existing project (.env migration)** — import existing secrets from a `.env` file into the vault, then delete the `.env` file.

Each step shows the exact terminal command and the expected output or AI agent response. All three runtimes (GitHub Copilot CLI, Claude Code, OpenCode) are covered side-by-side where steps differ; steps that are identical across runtimes are shown once.

---

## User Stories

### Discovery & Evaluation

1. As a developer evaluating see-crets, I want a short narrative intro at the top of the guide that shows the before/after (`.env` file vs. vault), so that I understand the value proposition in 30 seconds.
2. As a developer evaluating see-crets, I want to see a real terminal session with expected output, so that I can judge whether it will work in my environment before committing to the install.
3. As a developer evaluating see-crets, I want to understand what "the AI sees" vs. "what the vault holds" at each step, so that I can verify the security promise is real.
4. As a developer unfamiliar with OS vault backends, I want a one-line callout that tells me which backend is used on my OS, so that I don't have to read the full Architecture section.

### Installation & Setup

5. As a developer starting a new Node.js project, I want a step-by-step guide from `git clone` to first secret stored, so that I don't have to read multiple sections to assemble the flow.
6. As a developer with an existing `.env` file, I want a migration guide that shows how to import my existing secrets and remove the `.env` file safely, so that I can onboard without losing any credentials.
7. As a developer, I want each setup step to show the exact command and its expected terminal output, so that I can verify each step succeeded before moving on.
8. As a developer, I want to understand the three enforcement tiers before choosing which one to install, so that I pick the right level for my project without over- or under-configuring.
9. As a developer setting up Tier 2 on all three runtimes, I want platform-specific copy-paste commands shown side-by-side, so that I can follow the correct path for my AI tool without switching between sections.

### First Secret & Usage

10. As a developer, I want to store my first secret (`GITHUB_TOKEN`) in a single command, so that I see the vault working immediately.
11. As a developer, I want to see how my AI agent discovers available secrets using `see-crets list`, so that I understand how the LLM knows what to inject.
12. As a developer, I want to see a concrete example of `{{SECRET:my-app/github-token}}` being resolved in a shell command, so that I understand the placeholder syntax without reading the reference docs.
13. As a developer, I want to see the env-var injection flow (automatic `GITHUB_TOKEN` injection) in a real `fetch()` or shell command, so that I understand I don't always need to use placeholders.
14. As a developer, I want to see my AI agent use a secret in an API call (e.g., hitting the GitHub API), so that I can confirm end-to-end functionality.

### Scrubbing Verification

15. As a developer, I want the guide to show what happens when the AI's output would have contained a secret value, so that I can verify scrubbing is active.
16. As a developer, I want to see a concrete before/after: "AI response without see-crets" vs. "AI response with see-crets", so that the scrubbing behavior is tangible and not abstract.
17. As a developer, I want to understand which tier is responsible for scrubbing (Tier 3 / runtime hooks), so that I know what I need to install for this feature.

### Secret Rotation

18. As a developer, I want to see how to rotate a secret without changing any code or config, so that I understand see-crets manages the secret lifecycle, not just storage.
19. As a developer, I want to see `see-crets rotate` in action with expected output, so that I trust the rotation is atomic and won't break my running app.
20. As a developer, I want to verify my app still works after rotation (env var auto-re-injected), so that I'm confident the rotation is transparent to my agents.

### .env Migration

21. As a developer with an existing `.env` file, I want a one-command or scripted import flow, so that migration is not tedious.
22. As a developer, I want a warning callout that the `.env` file should be deleted (not just `.gitignore`d) after migration, so that I understand the full security benefit.
23. As a developer, I want to see `see-crets detect` used after migration to confirm all expected secrets are available, so that I have a checklist-style verification step.

### .see-crets.json Configuration

24. As a developer, I want the guide to show when and why I need `.see-crets.json`, so that I understand it's optional for standard keys (built-in map) but required for custom ones.
25. As a developer, I want to see the `.see-crets.json.example` file referenced and linked, so that I know a template exists.

---

## Implementation Decisions

### Location & Structure

- The new section is added to `README.md` as `## Walkthrough` immediately after the existing `## Quick Start` section.
- The Quick Start section remains unchanged — it is the fast-path (copy-paste setup); the Walkthrough is the narrative path (understand + verify).
- No new files are created. The guide lives entirely in `README.md`.

### Running Example

- The running example is a fictional `my-app` Node.js project that calls the GitHub API.
- The project-scoped vault key is `my-app/github-token`; the global fallback is `global/github-token`.
- The example demonstrates both the `{{SECRET:my-app/github-token}}` placeholder syntax and the automatic `GITHUB_TOKEN` env-var injection via the built-in map.

### Guide Structure (Ordered Sections)

1. **What you'll build** — 3-sentence intro with before/after (`.env` file vs. vault + AI sees keys only)
2. **Prerequisites** — Bun installed, OS vault available (single callout per OS), AI runtime installed
3. **Store your first secret** — `see-crets set my-app/github-token`, expected interactive prompt + success output
4. **Verify with your AI agent** — `see-crets list`, show what the LLM sees (key names, no values)
5. **Use a secret in a tool call** — placeholder `{{SECRET:my-app/github-token}}` in a shell command; show env-var auto-injection as an alternative
6. **See scrubbing in action** — ask the AI to echo the secret value; show `[REDACTED]` in the response (requires Tier 3)
7. **Rotate the secret** — `see-crets rotate my-app/github-token`, show new value prompted, app unaffected
8. **Migrate from .env** — scripted loop to import existing `.env` entries; `rm .env`; `see-crets detect` to verify
9. **Next steps** — links to CLI Reference, Enforcement Tiers, Built-in Env Var Map, Security Model

### Runtime Coverage

- Steps 1–3 (store, list, detect) are runtime-agnostic — shown once.
- Steps 4–6 (placeholder resolution, env injection, scrubbing) show all three runtimes side-by-side using a tabbed or headed sub-section pattern (matching existing Quick Start style).
- Step 7 (rotate) is runtime-agnostic — shown once.
- Step 8 (.env migration) is runtime-agnostic — shown once.

### Expected Output Style

- Every command block is followed by a fenced code block showing the expected terminal output or AI agent response.
- AI agent response examples are clearly labeled `# AI agent response` to distinguish them from terminal output.
- Scrubbing example uses a clearly labeled "without see-crets" vs. "with see-crets" pair.

### Tier Callouts

- Each step that requires a specific tier displays a small callout: `> 🔒 **Tier 2+** — requires plugin installation`.
- Steps 1–4 work at Tier 1; step 5 (env injection) requires Tier 2; step 6 (scrubbing) requires Tier 3.

---

## Testing Decisions

This PRD covers documentation only. No code is added or changed.

**What makes a good documentation test:**
- A reader unfamiliar with see-crets can follow the guide end-to-end without referring to other sections.
- Every command shown produces the expected output on a clean install.
- No step assumes context from a previous section of the README.

**Validation approach:**
- Manual walkthrough on each supported OS (macOS, Linux, Windows) before merge.
- Each expected output block must be verified against a real terminal session.
- The `.env` migration script must be tested on a real `.env` file with at least 3 entries.

---

## Out of Scope

- **Code changes**: No source code, hook scripts, or plugin files are modified.
- **New CLI commands**: No new `see-crets` subcommands are added for this guide.
- **Separate QUICKSTART.md file**: The guide lives in `README.md` only.
- **Video / GIF screencasts**: Out of scope for this PRD.
- **CI/CD integration guide**: Covered by a future PRD.
- **Team / shared vault setup**: Multi-developer workflows are out of scope.
- **Windows PowerShell-specific migration script**: The `.env` migration example targets Bash; a PowerShell variant is noted as a follow-up.

---

## Further Notes

- The existing `## Quick Start` section targets developers who want to copy-paste and go. The new `## Walkthrough` section targets developers who want to understand what they're doing. Both audiences are valid; the two sections are complementary, not redundant.
- The `.see-crets.json.example` file already exists in the repo root and should be referenced (not duplicated) in the guide.
- The `see-crets detect` command is underused in current docs — the walkthrough is a natural place to showcase it as a "health check" step.
- Consider adding a "TL;DR" box at the very top of the Walkthrough section (3–5 bullet points) for readers who skim before committing to reading the full guide.

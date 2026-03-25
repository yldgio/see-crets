# Plan: Walkthrough Guide (issue #17)

## Problem
Developers evaluating or onboarding `see-crets` have no end-to-end narrative. The README Quick Start is
a good copy-paste reference but shows no payoff — secrets never get used, scrubbed, or rotated. 
This plan adds a dedicated `WALKTHROUGH.md` that takes a developer from zero through a full
Node.js example: store → use → scrub → rotate → migrate from .env.

## Approach
- New file: **`WALKTHROUGH.md`** at repo root (keeps README lean, links from Quick Start)
- README gets one new line under `## Quick Start`: `> 📖 For a full narrative walkthrough, see [WALKTHROUGH.md](./WALKTHROUGH.md).`
- Running example: fictional `my-app` Node.js project, key `my-app/github-token`
- Tier 1 setup: link back to Quick Start (no duplication)
- Each step shows exact command + expected terminal output
- All 3 runtimes shown side-by-side only where steps diverge
- Tier callouts (🔒 Tier 2+) inline with steps
- No GitHub API response body shown — setup only

## Durable Decisions
| Decision | Chosen |
|----------|--------|
| File location | `WALKTHROUGH.md` (root), linked from README |
| Running example | Node.js `my-app`, key `my-app/github-token` |
| Tier 1 in walkthrough | Link to Quick Start, don't repeat |
| API call example | Show `fetch()` setup only (no response body) |
| Phase count | 5 |

---

## Phases

### Phase 1 — Scaffold & Evaluation Hook
**Goal**: A skimmer knows whether to invest 5 minutes after reading this phase alone.

- `WALKTHROUGH.md` file created with:
  - `## Walkthrough` heading + brief 2-sentence intro
  - **TL;DR box** (5 bullets: what you get, how long it takes)
  - **What you'll build** section: before/after comparison table (`.env` leak risk vs. vault with key-only view)
  - **OS vault backend** callout (1-liner per OS: Keychain / SecretService / Credential Manager)
  - **Tier overview** table (Tier 1 = 2 min / Tier 2 = 10 min / Tier 3 = bundled with Tier 2)
- README: add link to WALKTHROUGH.md under Quick Start intro

**Acceptance**: Reader can answer "will this work on my OS and with my tool?" without leaving Phase 1.

---

### Phase 2 — Fresh Project: Store & Discover
**Goal**: Developer stores first secret and sees what their AI agent will see.

- **Prerequisites** section: binary install (link to Quick Start build steps), OS vault available
- **Step 1 — Store your first secret**:
  ```
  see-crets set my-app/github-token
  ```
  Expected output shown (interactive prompt redacted, success line)
- **Step 2 — Install Tier 1** (link to Quick Start Tier 1, one sentence per runtime)
- **Step 3 — Discover secrets as your agent would**:
  ```
  see-crets list
  ```
  Expected output: key names only, no values — with annotation "↑ this is all the LLM ever sees"

**Acceptance**: Developer can reproduce both commands and match expected output on a clean install.

---

### Phase 3 — Use a Secret in a Tool Call
**Goal**: Developer sees two injection patterns working in a real Node.js context.

- **Step 4 — Placeholder syntax**:
  Show AI agent prompt using `{{SECRET:my-app/github-token}}` in a shell command; show how
  the runtime (Copilot CLI / Claude Code / OpenCode) resolves it before execution.
  Three sub-sections (one per runtime) with copy-paste examples — Tier 2 required callout.
- **Step 5 — Automatic env-var injection**:
  Show Node.js `fetch()` reading `process.env.GITHUB_TOKEN` — no placeholder needed.
  Explain: built-in env-var map auto-injects `my-app/github-token` → `GITHUB_TOKEN`.
  Link to Built-in Env Var Map section of README.
- **Step 6 — Custom key mapping** (optional callout):
  Show `.see-crets.json` snippet for a non-standard key; reference `.see-crets.json.example`.

**Acceptance**: Both injection patterns are demonstrable without running the project (code snippets are self-explanatory).

---

### Phase 4 — Scrubbing & Rotation
**Goal**: Developer sees the output safety net and knows how to rotate a secret.

- **Step 7 — See scrubbing in action** (🔒 Tier 3 callout):
  Side-by-side fenced code blocks:
  ```
  # Without see-crets Tier 3
  AI response: "The token is ghp_abc123XYZ..."

  # With see-crets Tier 3
  AI response: "The token is [REDACTED]"
  ```
  Brief explanation of which hook handles scrubbing and when.
- **Step 8 — Rotate a secret**:
  ```
  see-crets rotate my-app/github-token
  ```
  Expected output: prompts for new value, confirms update.
  Follow-up: run `see-crets list` again — key still present, value never shown.
  Note: env injection automatically picks up the new value on next tool call.

**Acceptance**: Both examples are clear without needing Tier 3 installed — the before/after makes the value tangible.

---

### Phase 5 — .env Migration & Next Steps
**Goal**: Developer with an existing project can migrate safely and knows where to go next.

- **Step 9 — Migrate from .env**:
  Bash one-liner / loop to import each `.env` entry:
  ```bash
  # For each non-comment, non-empty line in .env
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^# ]] && continue
    [[ -z "$key" ]] && continue
    see-crets set "my-app/${key,,}"
  done < .env
  ```
  Note: keys are lowercased and namespaced under `my-app/`.
- **Step 10 — Remove the .env file**:
  ```bash
  rm .env
  git rm --cached .env   # if previously tracked
  echo ".env" >> .gitignore
  ```
  Warning callout: `.gitignore` is not enough — delete the file.
- **Step 11 — Verify with detect**:
  ```
  see-crets detect
  ```
  Expected output: all expected keys present ✓
- **Next Steps** section: links to CLI Reference, Secret Namespaces, Built-in Env Var Map,
  Security Model, and Enforcement Tiers in README.

**Acceptance**: A developer with a 3-entry `.env` file can follow the migration and end with `see-crets detect` showing all keys present.

---

## Files Changed
| File | Change | Risk |
|------|--------|------|
| `WALKTHROUGH.md` | Created (new) | 🟢 |
| `README.md` | +1 line link under Quick Start | 🟢 |

## Out of Scope (this plan)
- Video / GIF screencasts
- PowerShell variant of the .env migration script
- CI/CD integration guide
- Windows-specific migration steps

## Issue
Closes #17

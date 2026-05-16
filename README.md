# GhostWriter CLI

> IBM BOB-powered knowledge extraction for departing engineers.
> Runs **locally** against your actual codebase. No uploads. No web app.

---

## How IBM BOB is used here

IBM BOB exposes a CLI called `bob-shell`. GhostWriter calls it as a **local subprocess** against files on your machine. No REST API, no HTTP requests — just CLI commands that BOB runs natively against your code.

The three `bob-shell` commands GhostWriter uses:

| Command | What it does |
|---------|-------------|
| `bob-shell explain <file>` | Summarizes the file, flags undocumented sections, scores complexity 1–10 |
| `bob-shell review <file>` | Finds risks, missing docs, hidden dependencies — outputs HIGH/MEDIUM/LOW |
| `bob-shell summarize <dir>` | High-level purpose summary for a directory or module |

All output is captured as JSON and used to build the risk profile, interview questions, and final documentation artifacts.

---

## Setup

### Step 1 — Install IBM BOB shell

Follow the instructions at [bob.ibm.com/docs/ide](https://bob.ibm.com/docs/ide) to install `bob-shell`.

Then authenticate with your API key:

```bash
bob login
# Enter your API key from bob.ibm.com/docs/ide/account/api-keys
```

Verify it works:

```bash
bob-shell explain ./src/index.js --format json
```

### Step 2 — Install GhostWriter

```bash
cd ghostwriter-cli/
npm install
```

### Step 3 — Run it

```bash
# From inside the folder where your ghostwritter script is present open the terminal in bob ide:
cd /path/to/your/repo

node ghostwriter.js --github your-github-repo-link --user your-user-name
```

Or run interactively (it will ask you for username and role):

```bash
node /path/to/ghostwriter-cli/ghostwriter.js
```

---

## What it does, step by step

```
Phase 1 — Git Contribution Mapping
  ↳ Runs: git log --author=<username> --name-only
  ↳ Builds: map of every file the engineer ever touched

Phase 2 — IBM BOB Codebase Analysis
  ↳ Runs: bob-shell explain <file> on each touched file
  ↳ Runs: bob-shell review <file> to flag risks
  ↳ Builds: risk profile sorted HIGH → MEDIUM → LOW

Phase 3 — Knowledge Interview (terminal UI)
  ↳ Generates 8 targeted questions from BOB's analysis
  ↳ Each question references a specific file and what BOB flagged
  ↳ Engineer types answers directly in the terminal
  ↳ Short answers trigger an automatic follow-up

Phase 4 — Artifact Generation
  ↳ CodeKnowledgeMap.md   — file-by-file danger briefing
  ↳ ADRBundle.md          — architectural decision records
  ↳ OnboardingPlaybook.md — full replacement-engineer guide
  ↳ ghostwriter-session.json — raw data for future regeneration
```

---

## Output files

Everything is written to `.ghostwriter/` (or your `--out` path):

```
.ghostwriter/
  ├── myrepo-CodeKnowledgeMap.md
  ├── myrepo-ADRBundle.md
  ├── myrepo-OnboardingPlaybook.md
  └── ghostwriter-session.json
```

Share the `.ghostwriter/` folder with the incoming engineer. That's it.

---

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--repo` | `cwd` | Path to the git repository |
| `--user` | (prompt) | Git author name / GitHub username |
| `--role` | (prompt) | The engineer's role description |
| `--out` | `<repo>/.ghostwriter` | Output directory for artifacts |

---

## If bob-shell isn't available yet

GhostWriter gracefully degrades. If `bob-shell` isn't installed or authenticated, it falls back to git-only analysis (commit history, file churn, basic heuristics). You'll see a warning per file:

```
⚠ bob-shell not available for payments.js — using git-based analysis
```

The interview and artifact generation still work — they just use less precise risk data.

---

## IBM BOB API key

Your API key from `bob.ibm.com/docs/ide/account/api-keys` is used **only** by `bob-shell` locally. GhostWriter never reads or transmits it. Authentication is handled entirely by the `bob login` command.

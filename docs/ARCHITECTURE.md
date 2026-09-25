# PR Compass — Architecture

## Overview

```
Bob IDE (analysis) → validated JSON → PR Compass website (rendering)
```

The website **does not invoke Bob** at runtime. It only renders pre-produced JSON.
Bob runs separately, produces a `ReviewBrief` JSON file, and the team places it in
`public/demo/review-brief.json` before opening the website.

---

## Components

### 1. Bob skill (`review-brief`)

Location: `.bob/skills/review-brief/SKILL.md`

The skill guides Bob through:
1. Reading the git diff and PR metadata.
2. Inspecting unchanged callers.
3. Reading relevant requirements and project documents.
4. Producing and validating a `ReviewBrief` JSON document.

The skill is read-only with respect to application code. It does not commit, push, or modify PRs.

### 2. Data contract (`src/types/ReviewBrief.ts`)

TypeScript types and Zod schemas that define the `ReviewBrief` structure.
Both the skill (Bob's output) and the website (consumer) must conform to this contract.

The loader (`src/types/loader.ts`) fetches and validates JSON at runtime:
- On valid data: returns `{ ok: true, brief: ReviewBrief }`.
- On invalid data: returns `{ ok: false, error: string }`.

### 3. Website (`src/`)

A single-page React + TypeScript application built with Vite.

On load, it fetches `/demo/review-brief.json` and renders:
- **Header** — PR title, URL, branch names, commit SHAs (or honest "unavailable" labels).
- **What Changes** — behavioral changes with before/after comparison and evidence badges.
- **Where to Look** — ordered review locations with reasons and source references.
- **What Needs Human Judgment** — open decisions and assumptions.
- **Checks & Limitations** — check results (passed/failed/not-run) and analyst limitations.

### 4. Sample project (`sample-project/`)

A function-level TypeScript simulation (not a running HTTP service) used as the PR subject.

- `src/searchService.ts` — simulates a search handler returning `{ status, body }`.
- `src/searchClient.ts` — interprets the response into a `DisplayState`.
- `tests/` — Vitest unit tests for baseline behavior.

The sample project exists to give the team a real, committable codebase on which to create a PR
that the Bob skill can analyze.

---

## Data flow

```
┌─────────────────────────────────────────┐
│  Bob IDE (offline, run by team member)  │
│                                         │
│  1. Read git diff                       │
│  2. Inspect callers                     │
│  3. Read docs/sample-context/           │
│  4. Produce ReviewBrief JSON            │
│  5. Validate against schema             │
└──────────────────┬──────────────────────┘
                   │ copy file
                   ▼
        public/demo/review-brief.json
                   │
                   │ fetch at page load
                   ▼
┌─────────────────────────────────────────┐
│  PR Compass website (browser)           │
│                                         │
│  1. loadReviewBrief(url)                │
│  2. Zod parse + validate                │
│  3. Render sections                     │
└─────────────────────────────────────────┘
```

---

## Technology choices

| Concern | Choice | Reason |
|---|---|---|
| UI framework | React 18 | Familiar, well-tested, required by spec |
| Language | TypeScript | Type safety across contract + UI |
| Build tool | Vite | Fast, standard for React/TS projects |
| Test runner | Vitest | Native Vite integration, no config friction |
| Runtime validation | Zod | Small, excellent TypeScript inference |
| Styling | Plain CSS (custom properties) | No external dependency, accessible defaults |

---

## Constraints

- No backend. The website is a static single-page app.
- No GitHub API or OAuth. Source links are rendered from data in the JSON, not fetched live.
- The website cannot manufacture source links. If a commit SHA or URL is null, it says so.

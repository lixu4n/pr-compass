# PR Compass

**IBM Bob Hackathon submission** | Two-person team

PR Compass helps a human understand an unfamiliar pull request with less searching and reading.
It presents a compact, evidence-linked review brief answering three questions:

1. **What changes?** — the behavioral difference, not just which files changed.
2. **Where should I look?** — an ordered list of code locations with a reason for each.
3. **What needs human judgment?** — assumptions, unresolved questions, and decisions.

The website is a companion to the diff, not an automated approval system.

---

## Current implementation status

| Component | Status |
|---|---|
| TypeScript types + Zod validation | ✅ Complete |
| Demo fixture JSON | ✅ Complete (mock/demo data) |
| React website (4 sections) | ✅ Complete |
| Bob skill (`review-brief`) | ✅ Complete |
| Sample project (search service + client) | ✅ Complete |
| Unit tests (schema, loader, service, client) | ✅ Complete |
| Documentation | ✅ Complete |
| Real PR to analyze | ⬜ Next step (see below) |
| Actual Bob skill run | ⬜ Requires real PR |
| Measured evaluation | ⬜ Requires real PR |

---

## Installation and running

**Requirements:** Node.js ≥ 20, npm

```bash
cd pr-compass
npm install
npm run dev          # start dev server at http://localhost:5173
```

## Run tests

```bash
npm test             # run all unit tests once
npm run test:watch   # watch mode
```

## Type-check

```bash
npm run typecheck
```

## Production build

```bash
npm run build        # typecheck + vite build → dist/
```

---

## How the sample project works

`sample-project/` is a **function-level simulation** — it is not a running HTTP server.
It contains two plain TypeScript modules:

- **`src/searchService.ts`** — simulates a search endpoint. Returns a `SearchResponse` object
  with `status: 200` and `body: { results: [...] }`. An empty query or a query with no matches
  returns `{ results: [] }`.
- **`src/searchClient.ts`** — interprets a `SearchResponse` and returns a `DisplayState`
  (`results` or `empty`).

The baseline behavior (on `main`): no-results → 200 + empty list.

Unit tests live in `sample-project/tests/` and run via Vitest alongside the website tests.

---

## How to use the Bob skill

The `review-brief` skill is in `.bob/skills/review-brief/SKILL.md`.
Start a new Bob IDE task and either:

- Type `/review-brief` in the chat to invoke it manually, or
- Ask "analyze this pull request and produce a review brief" — Bob will auto-activate the skill.

The skill guides Bob to:
1. Identify base/head commit SHAs.
2. Inspect the diff and unchanged callers.
3. Read relevant requirements and project decisions.
4. Produce a validated `ReviewBrief` JSON matching the contract in `src/types/ReviewBrief.ts`.

---

## How to load a generated brief

After a Bob skill run produces `review-brief.json`:

1. Copy or move the file to `public/demo/review-brief.json`.
2. Run `npm run dev` (or `npm run build && npm run preview`).
3. The website loads the file at startup and renders it.

If the JSON fails schema validation, the website shows an error message with the validation details.

---

## Demo limitations

- The current `public/demo/review-brief.json` is illustrative demo data. No real PR, branch,
  commit SHA, or executed check exists.
- All source references point to the baseline `sample-project/` files; line numbers will differ
  in a real PR.
- The "before/after" descriptions are inferred from `docs/sample-context/compatibility.md`,
  not from an observed diff.

---

## Where session evidence belongs

Save Bob IDE task-session summary screenshots to:

```
bob_sessions/teammate-one/
bob_sessions/teammate-two/
```

See `bob_sessions/README.md` for instructions. Never generate fake screenshots or fabricated evidence.

---

## Next steps: creating the real sample PR

Follow these steps to produce a real PR that the skill can analyze:

### 1. Commit the baseline

```bash
git init
git add .
git commit -m "chore: initial baseline — search returns 200 + empty list"
```

### 2. Create a branch

```bash
git checkout -b feat/404-empty-search
```

### 3. Introduce the proposed change

Edit `sample-project/src/searchService.ts` to return a 404-style response when results are empty.
Update `sample-project/src/searchClient.ts` to handle the new response shape.
Update the tests.

### 4. Open a real PR

Push the branch to GitHub and open a pull request against `main`.

### 5. Analyze it with the Bob skill

In Bob IDE, open the repository and run `/review-brief`.
Bob will read the diff, inspect callers, and produce a `ReviewBrief` JSON.
Copy it to `public/demo/review-brief.json` and run the website.

---

## Licensing

No license file exists. Licensing is a team decision — choose and add a LICENSE file before
publishing or sharing this project externally.

# Context quality evaluation

Run `npm run eval:context` from the repository root. No credentials, model calls,
or network access are required. The JSON report compares the old prefix-selection
strategy with changed-hunk neighborhoods on three synthetic selection fixtures.
It fails if the new selector violates a fixture requirement. It is not an accuracy
benchmark, representative dataset, or evidence of reviewer time savings.

Three additional human evaluation cases record the real PR #3 / PR #4 failure
modes and insufficient-context behavior. They are deliberately reported as pending,
not counted as passes. For each provider output, preserve the exact source bundle,
model identifier, prompt revision, generated JSON, elapsed time, and provider usage.
Have a reviewer annotate each factual claim as supported, contradicted, or unclear;
mark each context item necessary or unnecessary; record required facts missed and
whether the reading order helped. Do not use a model's own judgment as ground truth.

Report counts and denominators separately for quote provenance, supported claims,
necessary context, and missing required facts. Keep failed and unavailable outputs
in the sample. Compare old and new versions on the same bundles. A future study
should include independently reviewed bug-fix, refactor, config, and documentation
PRs before claiming general improvements.

## Implemented scope

- JavaScript/TypeScript head snippets now center on actual unified-diff hunk ranges,
  merge overlapping neighborhoods, retain line links, and respect a byte budget.
- This is diff-aware selection, **not AST symbol analysis or caller discovery**.
  A large function may be only partly captured; project documents remain a bounded
  fixed list. Those are explicit next improvements, not current capabilities.
- Purpose/context claims can carry exact source excerpts. Fabricated excerpts and
  excerpts attached to a different citation are rejected during assembly. Evidence
  is retained in JSON artifacts; Markdown retains the compact claim/source layout.
- Legacy output without excerpts remains accepted for compatibility, with an
  explicit limitation. Exact matching does not prove the claim follows from the
  excerpt; the tests intentionally demonstrate that distinction.
- Prompt instructions permit zero relevant-context items and discourage repetition,
  manual/automatic workflow confusion, and treating requested cost as guaranteed.

No live model evaluation has been run for this revision. Existing live results
from earlier revisions must not be presented as validation of these changes.

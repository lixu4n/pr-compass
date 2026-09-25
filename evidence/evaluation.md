# Evaluation Protocol

This document defines the evaluation protocol for measuring whether PR Compass reduces reviewer
effort without degrading understanding or causing important issues to be missed.

**Status: protocol defined — no results yet. Results will be added after the real sample PR is
created, analyzed, and reviewed.**

---

## Hypothesis

Reviewers given a PR Compass brief will spend less active lookup time and produce an equally
accurate understanding of the PR compared to reviewers without the brief.

---

## Metrics

### 1. Active review time

Definition: elapsed time from "reviewer opens PR" to "reviewer posts first substantive comment."
Measurement: self-reported start/stop timestamps, or screen-recording timestamps.

### 2. Accuracy of understanding

Definition: number of correct answers to a short questionnaire about the PR's behavioral changes,
affected callers, and open decisions.
Measurement: questionnaire administered after review, before reading discussion.

### 3. Manual context lookups

Definition: number of times the reviewer opens a file, follows a link, or performs a search that
is not part of normal diff reading.
Measurement: self-reported tally or observer count.

### 4. Missed important issues

Definition: number of significant issues (per a pre-agreed gold standard) that the reviewer did
not mention in their first review comment.
Measurement: comparison against gold standard prepared before the evaluation.

---

## Protocol

1. Define the gold standard for the sample PR before running any evaluation.
2. Assign one reviewer to "with brief" condition and one to "without brief" condition.
3. Run reviews independently without cross-contamination.
4. Administer the questionnaire immediately after each review.
5. Compare metrics between conditions.

---

## Results

*(To be filled in after evaluation runs.)*

| Metric | Without brief | With brief | Delta |
|---|---|---|---|
| Active review time | — | — | — |
| Accuracy score | — | — | — |
| Context lookups | — | — | — |
| Missed issues | — | — | — |

---

## Limitations of this evaluation

- Two-person team; sample size is 1 per condition.
- Evaluators are also the authors — potential bias.
- The sample PR is synthetic; results may not generalize.

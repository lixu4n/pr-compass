# Problem & Solution Statement

**[OUTLINE — to be completed by the team. Maximum 500 words in the final submission.]**

---

## The problem

*(Describe the pain point. Who experiences it? When? What does it cost them?)*

Code review is a critical quality gate, but it is frequently rushed or shallow — especially on
pull requests in unfamiliar parts of the codebase. Reviewers must independently reconstruct context
that the author already had: which behavior actually changes, which other files are affected, and
which assumptions need validation. This context-building takes time and is often incomplete.

*(Add team's specific observations and evidence here.)*

---

## Our solution

*(Describe PR Compass in concrete terms. What does it do? What does it NOT do?)*

PR Compass is a review brief generator. A team member runs the `review-brief` Bob skill against a
pull request. The skill analyzes the diff, inspects callers, reads project context, and produces
a structured JSON document. That document is loaded by a single-page website that presents:

1. **What changes** — behavioral differences with before/after comparisons.
2. **Where to look** — an ordered list of the most relevant code locations.
3. **What needs human judgment** — assumptions and open decisions.

The website is a companion to the diff, not an approval system.

---

## How it uses IBM Bob

*(Be specific about which Bob capabilities are used and how.)*

- The `review-brief` Bob skill guides Bob through a structured analysis workflow.
- Bob reads the diff, runs targeted `grep` and `read_file` calls, and consults project documents.
- Bob produces validated JSON matching a TypeScript/Zod schema.
- Bob does not automatically approve, merge, or repair the PR.

*(Add concrete examples from actual skill runs once the real PR is created.)*

---

## What we measured

*(Only include results that actually exist. Do not fabricate outcomes.)*

No evaluation results exist yet. The evaluation protocol is defined in `evidence/evaluation.md`.
Results will be added after the sample PR is created and analyzed.

---

*Final statement must not exceed 500 words. Remove outline comments before submission.*

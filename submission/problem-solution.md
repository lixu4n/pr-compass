# Problem and solution

Reviewers of unfamiliar pull requests spend time reconstructing why a change
exists and deciding which files deserve attention. A diff shows edits but does
not necessarily explain the surrounding context or a useful reading order.

PR Compass prepares a compact GitHub comment with three sections: Purpose,
Relevant context, and Suggested reading order. Source links point reviewers to
specific analyzed revisions. North, our visual guide, identifies the brief.
Humans retain responsibility for review and approval.

The automation collects PR metadata, changed-file patches, bounded source
excerpts, and selected project documents. IBM Bob Shell (or the optional OpenAI provider) analyzes that bundle
under restricted capabilities and returns structured JSON. TypeScript/Zod
validation and a deterministic renderer produce the comment. The publisher
checks PR eligibility and commit freshness before creating or updating its own
bot comment. Collection is bounded and does not establish comprehensive caller
or repository understanding.

The real demonstration target is PR #3, which narrows search matching to titles
while preserving case-insensitive matching and empty-result behavior. An existing
user-posted Compass brief is visible on that PR. A live North App comment and automatic refresh on PR #4 are now verified.
Actual Bob charges remain unverified. The PR #4 brief contained a workflow-description
error despite passing structural validation; see [verification](../docs/LIVE-VERIFICATION.md).

The manual test workflow disables repair and requests a total 0.5-Bobcoin limit.
It has no automatic PR trigger. A separate opt-in automatic workflow handles
eligible PR events after repository setup. The Vercel-ready website demonstrates
the flow and guides setup; its example states are not live results. The original
React viewer remains available at `/demo`.

No reviewer-time savings or accuracy improvement has been measured. Our
submission distinguishes implementation and offline checks from live evidence.

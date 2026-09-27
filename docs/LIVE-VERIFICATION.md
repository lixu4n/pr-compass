# Live verification — 2026-09-27

## Observed results

- Manual PR #3 run: https://github.com/lixu4n/pr-compass/actions/runs/36296216148
- North comment: https://github.com/lixu4n/pr-compass/pull/3#issuecomment-5852849724
- Automatic PR #4 success: https://github.com/lixu4n/pr-compass/actions/runs/36296973736
- Updated comment: https://github.com/lixu4n/pr-compass/pull/4#issuecomment-5852888873
- Automatic analyzed head: `1ead1938cd6fe78fbe7ab90b84434b99063afcc3`.
- Trusted action revision: `af680d8958b792f38a55e1a261a85e5a86198dba`.
- Check result: `Compass context` → success, `Brief posted`.
- Exactly one North comment on PR #4, ID `5852888873`, retained across updates.
- App author is `compass-by-north[bot]`; avatar visually confirmed as North.
- Inline North image removed from renderer and existing PR #3 App comment.

Two earlier automatic runs rejected purpose summaries over 120 characters and
posted explicit unavailable results. After increasing the limit to 300, updating
the prompt, and testing both length boundaries, one controlled run succeeded.
Repair remained off. Verification passed 257 tests, 10 packaged-action tests,
and TypeScript checks. These counts include offline tests, not additional paid runs.

## Human accuracy review

PR #3's purpose matches its diff: remove snippet matching, retain case-insensitive
title matching, and add a snippet-only regression test. Its brief notes limited
caller coverage. The reading-order phrase “post-merge code” is imprecise: the
source is the analyzed PR head, not evidence that the PR has merged.

PR #4 correctly identifies a documentation-only smoke test and comment refresh.
However, its second context bullet incorrectly says the automatic workflow targets
a specific PR and checks out the workflow's own commit. Those describe the manual
demo; the automatic workflow uses event PR identity and a separately pinned Compass
revision. The same bullet says spending is capped at 0.5 Bobcoins. This is a
requested vendor limit, not independently verified billing enforcement.

These are factual generation errors despite valid schema and resolvable citations.
Do not present the brief as a correctness verdict or claim measured accuracy.
The recorded comment remains the original generated evidence, not a silently edited
success example. Future quality work should distinguish manual and automatic
workflows and strengthen claim-to-source checking.

## Remaining evidence

Actual Bob charges must be checked in the user's account; no billing amount is
claimed here. Both teammates' development screenshots are in `bob_sessions/`.
No demo video or public website deployment has been verified. Hosted public
GitHub App onboarding is implemented locally but not deployed or live-tested.

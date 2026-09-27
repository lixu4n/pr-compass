# IBM Bob usage

PR Compass integrates IBM Bob Shell to turn collected pull-request context into a
structured review brief. The adapter targets verified Bob Shell 2.0.5 and passes
bounded input over stdin. It disables tool groups, MCP, and subagents, uses an
isolated environment, and requires explicit license acceptance and an API key.

The intended live demo is one analysis of PR #3 with repair disabled, four turns,
and a requested total limit of 0.5 Bobcoins. This requested limit is not an
independently verified billing guarantee. Actual usage must be recorded from Bob.
The resulting brief is validated, rendered, and published by our GitHub Action;
Bob does not approve, merge, or modify the PR.

The repository also includes the earlier `review-brief` Bob IDE skill for a
structured review workflow. Its presence does not itself prove that a session
executed every described step.

An existing user-posted Compass comment on PR #3 is visible. A new Actions-bot
publication, actual usage verification, and demo recording remain pending.
Offline automated tests use fake Bob and GitHub services and do not demonstrate
real inference.

Session evidence includes both teammates:

- `bob_sessions/teammate-one/2026-09-26-bob-analysis.png` captures the actual Bob
  IDE session showing test and type-check commands, an earlier sample-analysis
  result, and writing/validating a review brief. It is development-session
  evidence, not the controlled PR #3 run or its cost.
- `bob_sessions/teammate-two/teammate-two_task02_contract_repair.png` is the
  existing teammate-two evidence supplied in the repository.

No fabricated screenshots or benchmark results are used.

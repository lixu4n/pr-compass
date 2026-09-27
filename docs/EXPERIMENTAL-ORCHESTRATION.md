# Experimental Bob orchestration

**Compass-managed three-role orchestration powered by IBM Bob.** This is
application-managed sequencing of restricted Bob Shell calls, not native IBM Bob
subagents. No live verification or paid inference has been performed for this path.

## Opt-in Action mode

The default is `analysis_mode: single`, preserving the existing provider route.
On the experimental branch, set `analysis_mode: bob-multi-role` (CLI:
`COMPASS_ANALYSIS_MODE=bob-multi-role`) with `provider: bob`, `allow_repair: false`,
Bob credentials and explicit license consent. Other providers or repair enabled
are rejected before collection or inference. Private-code consent remains required.
The optional hosted worker is unchanged. No repository secrets, activation flags,
or deployed Action references are changed by this implementation.

The Action still produces one compact context comment using its configured bot
identity. Existing ownership, eligibility and final freshness publication gates
remain in force. Dry-run remains the default; dry-run can still spend Bobcoins.

## Sequential stages

1. Investigator receives neutral references and returns a strict plan of at most
   three paths and reasons. It never receives Writer output instructions.
2. Compass retrieves at the exact analyzed head, with 12,000 bytes per file and
   24,000 bytes total. Allowed extensions are TS/TSX/JS/JSX/Markdown, plus the
   narrow `.github/workflows/*.yml` and `*.yaml` exception. Absolute paths,
   traversal, URLs, hidden directories outside that exception, secret/credential
   directories and known generated/vendor directories are rejected. Path filtering
   is not a secret detector.
3. A patch or bounded snippet does not count as a complete file. One fetch per
   requested path can expand it. Equivalent full content reuses its source ID;
   partial records remain available and expanded content gets a new ID. Initial
   collection omissions are retained conservatively.
4. Writer returns the normal six-field contract, with strict nested fields and
   supporting excerpts for cited factual purpose/context claims. Manifest, excerpt,
   schema and full brief validation run before the next call. Unavailable/empty
   candidates and duplicate reading orders stop here.
5. Evidence Checker receives its own contract and host-assigned statement IDs,
   including reading explanations and limitations. `supported` is advisory about
   the brief, never PR approval. `unsupported` and `insufficient_evidence` withhold
   the candidate; the Action may publish only an honest unavailable result.
6. Final validation and the existing publication gates run. Snapshot/eligibility
   checks occur around role calls and retrieval. Cancellation is checked between
   stages; it does not immediately abort an in-flight Bob process, which retains
   its existing timeout. Detected cancellation or stale state suppresses publishing.

There are at most three inference calls, no automatic retries, repair loop, or
provider fallback. Failures return sanitized structured results. Provider error
text and model prompts/outputs are not written into the orchestration trace.

## Budget and artifacts

One requested allowance is split 20% / 60% / 20%: for 0.5 Bobcoins, the calls request
0.1, 0.3 and 0.1. These are vendor-requested limits, not guaranteed billed costs.
Actual usage is explicitly `null` because this adapter does not extract verified
usage. Disabled tools, MCP and native subagents, isolated environment, minimal
credentials, and per-call input/output/turn/time limits remain unchanged.

`orchestration-trace.json` is saved beside the brief and comment, with attempted
roles, requested allowances, outcomes, durations, retrieval paths/reasons/outcomes,
source IDs and unknown actual usage. Known credentials are redacted from retrieval
text; treat these private-mode artifacts as repository data, not public telemetry.

Offline unit and packaged CLI tests use injected providers/fake services. They
verify control flow and safeguards, not semantic accuracy or productivity gains.
Milestone 3 requires separate paid authorization and a frozen PR with a human
answer key before any accuracy comparison. No automatic publication is planned
for that first experiment.

## Native Bob explore experiment

`analysis_mode: bob-native-explore` enables native delegation inside the
Investigator call. It requires Bob, repair disabled, explicit license consent,
and `dry_run: true`. Publication is rejected before external work. Single-call
and ordinary three-role modes continue to disable native subagents.

The Investigator requests exactly three sequential `spawn_subagent` calls using
Bob's `explore` preset: purpose/change evidence, workflow/contracts, and
tests/limitations. Each child receives selected reference text in its task.
This initial implementation explores supplied evidence only: reads, edits,
commands, MCP, skills, todos and mode switches remain disabled. It does not give
children an autonomous repository checkout or broaden GitHub access. Compass
still performs bounded retrieval after the plan, then runs Writer and Checker.

The native call uses `stream-json`. Compass requires three unique explore tool
calls and successful matching results plus a successful final envelope. Missing
or failed events withhold output, with no fallback or retry. This detects actual
reported tool execution rather than trusting prose claiming agents were used.
Offline fixtures verify this parser; compatibility with real emitted events and
live child behavior remains unverified. Requested count is a prompt instruction,
not a pre-execution hard cap; unexpected extra calls are rejected after execution.

The native investigation shares the Investigator's 20% requested allowance; no
new per-child allowance is added. Inspection of installed Bob Shell 2.0.5 shows
children receive the parent's remaining budget and report spend to the parent.
This is not a verified billing guarantee. Child turn limits are Bob-controlled;
Compass's parent process timeout/output limits still apply. Native trace records
observed/completed counts and any vendor-reported session cost, separately from
verified account charges (unknown). No real native inference has been performed.

References inspected for this implementation:
- https://bob.ibm.com/docs/shell/features/subagents
- https://bob.ibm.com/docs/shell/features/modes
- https://bob.ibm.com/docs/shell/getting-started/start-bobshell-non-interactive

IBM documents Ask mode as explore-only and headless tool calls as pre-approved.
No global auto-approval settings are changed. The subprocess isolation is not an
OS sandbox; use a dedicated runner before considering a future read-enabled mode.

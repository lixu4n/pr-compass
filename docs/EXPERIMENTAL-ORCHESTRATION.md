# Experimental Bob orchestration

Branch: `experiment/bob-orchestration`. Not wired into the default Action or hosted
worker. No live verification or paid inference has been performed for this path.

`tools/compass/orchestration.ts` exposes `orchestrate(collection, instructions,
provider, call, totalRequestedCost)` and a `restrictedBobAgents(config)` adapter.
The caller must explicitly supply Bob credentials/license consent and opt into
execution. There is no automatic publication: the returned brief must still pass
normal publication freshness and eligibility checks in a future integration.

Three sequential, separately prompted roles:
1. Investigator requests up to three source/test/Markdown paths with reasons.
2. Compass fetches allowed paths at the exact analyzed head (12 KB per file,
   24 KB total), records successes/omissions, and augments the source manifest.
3. Writer generates the normal contract; deterministic checks run before the
   evidence reviewer can return advisory approval or concerns. Rejection stops;
   there are no retries, repair calls, or fallback publication.

The requested total Bobcoin budget is split 20% / 60% / 20%. This is vendor-requested
budgeting, not an independently enforced billing cap. Each invocation retains the
existing isolated environment, disabled tools/MCP/native subagents, and runtime
limits. Three calls may take up to three invocation timeouts.

This is **Compass-managed multi-role orchestration**, not native IBM Bob subagents.
`bob run --help` exposes subagent controls, but safe child-agent permissions and
budget inheritance have not been verified. Do not claim native subagent support.

Retrieval is restricted but not a secret detector: source files can themselves
contain sensitive data. The normal repository authorization and private-code
consent must happen before calling this module. No target code is executed.
Model review is advisory and can miss errors; human accuracy evaluation remains
necessary. Offline tests cover role order, shared requested budget, immutable
revision retrieval, blocked paths, oversized plans, and reviewer rejection.

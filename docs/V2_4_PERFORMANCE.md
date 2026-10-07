# v2.4 local performance evidence

Baseline measured 2026-10-07, final source measured 2026-10-08 on the same Windows machine with Vite production builds.
Baseline: `361809f2ed045e5b1e5c2be5809c21f537ec90e4`, extracted with
`git archive` into an isolated directory. No active checkout was reset.

Fixture: 150 projects, 1,500 tasks, 3,000 edges, 2,000 documents, 5,000 wiki
links, 100 conversations with 1,000 messages each, and 50/100KB Markdown.
Each build ran five independent samples, one browser worker, zero retries.
No other build or test ran during sampling. Values below are the median of
CDP ScriptDuration deltas; typing uses the median of each sample's p95
TaskDuration. These are browser CPU measurements, not network response times.

| Interaction | Baseline ms | Current ms | Change |
| --- | ---: | ---: | ---: |
| Now→Scheduled | 6.138 | 6.160 | +0.36% |
| Task tab switch | 7.027 | 7.062 | +0.50% |
| Project filter | 10.591 | 10.687 | +0.91% |
| List→Board | 5.665 | 5.817 | +2.68% |
| Calendar open | 12.165 | 11.107 | -8.70% |
| Calendar month switch | 1.963 | 2.035 | +3.67% |
| Dependency local graph | 24.229 | 21.516 | -11.20% |
| Task picker open | 2.805 | 2.573 | -8.27% |
| Task picker drill-down | 1.751 | 1.832 | +4.63% |
| Knowledge local graph | 16.058 | 16.834 | +4.83% |
| 50KB typing p95 | 10.189 | 9.238 | -9.33% |
| 100KB typing p95 | 13.552 | 13.093 | -3.39% |
| Atlas conversation list | 33.734 | 31.027 | -8.02% |
| Atlas conversation open | 17.679 | 16.568 | -6.28% |

All fourteen measurements satisfy the unchanged maximum 10% regression gate.
All five samples had 10 live list rows, 14 board rows, and 9 conversation rows.
The 100-session summary response was 27,771 bytes; opening loads message pages.

The earlier knowledge measurement could settle on the previous dependency
graph's still-visible node. Both builds now wait for the actual focus document
node and for the picker to unmount. This strengthens the completion condition.
The dependency fixture explicitly selects PROJECT_TREE in the current build,
matching the baseline's implicit subtree membership. External boundary behavior
is separately verified; no Domain ownership changed.

Initial failures, intermediate measurements, and CPU profiles are retained in
ignored `.artifacts/session127-*`. Profiling led to mode-specific project
derivation, reusable task filter results, and fewer temporary allocations in the
knowledge index. No measurement failures were hidden with Playwright retries.

Cold transfer check: 500 document bodies growing from 1KB to 50KB change initial
bootstrap from 1,217,900 to 1,218,400 decoded bytes (+0.0411%). Brotli transfers
11,486 bytes for the larger metadata fixture. Hydrating one 50KB body transfers
51,545 bytes; the legacy full snapshot is 26,799,277 bytes. Initial bootstrap
therefore remains body-light. Browser shell/RTT and native transport checks are
separate tests; this table does not assert their final acceptance status.

Machine-readable evidence: [interactions](benchmarks/v2.4-interaction.json) and
[cold transfer](benchmarks/v2.4-cold-transfer.json). Raw five-sample files use
`session127-baseline-settled` and `session127-current-acceptance` prefixes.

Reproduce after building each checkout:

```powershell
$env:ATLAS_BENCHMARK_PREFIX = 'your-build-prefix'
pnpm exec playwright test --project=desktop-zh --grep 'v2.2 complete release fixture interaction and editor benchmark' --repeat-each=5 --workers=1 --retries=0
```

Create the ignored `.artifacts` output directory before running the extracted
baseline. Apply the same two settled-DOM assertions to its measurement test.
Product source in the archived baseline remains unchanged.

Final cold browser matrix (2026-10-08): all nine cases pass. With API dispatch delays of 200/800ms, shell FCP is 116–160ms and precedes bootstrap completion. With real CDP 150ms latency and 128KiB/s bandwidth, static JavaScript download still dominates FCP around 18s, comparable to the v2.3 historical 18.036–18.112s baseline. This is retained evidence, not a claim of fast cold static delivery.

| Browser | Bandwidth-limited FCP ms | Metadata usable ms | Compressed bootstrap bytes | Lazy body ms |
| --- | ---: | ---: | ---: | ---: |
| desktop-en | 18096 | 20756.8 | 48836 | 178.2 |
| desktop-zh | 18080 | 20863.8 | 48947 | 170.5 |
| mobile-zh | 18040 | 20785.6 | 48740 | 174.3 |

All nine initial responses are `/api/bootstrap` with zero eager bodies. These single browser observations are not p95 distributions. [Raw browser evidence](benchmarks/v2.4-cold-browser.json) preserves session restoration, requested paths, body hydration and authenticated search timing. Full final Playwright is339/339; final CI-equivalent unit/integration115files703tests.

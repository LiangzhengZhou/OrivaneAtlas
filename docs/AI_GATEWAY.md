# AI execution and data permission

AI is optional. Current installers connect to your own server; credentials and model requests belong to that server's configured account, not to a shared public AI service.

## Configure and use

Add a personal provider in the AI settings. The current adapter accepts a public HTTPS endpoint with the Chat Completions or Responses protocol. Settings can apply to your personal workspace, a project or a knowledge space. Each scope supports multiple named profiles, each with its own provider, model and version. Existing configurations remain the default profile. Use **Open / create profile** to add a profile, then explicitly select it for a request. Unknown or deleted named profiles never fall back to another provider. Approval and dispatch use the profile recorded on the run, not whichever profile is currently selected in the UI. API keys are kept in the server's separate encrypted vault, never in Markdown, database receipts or browser storage. Back up the vault and its master key separately using your own secure operational procedure.

In a note or knowledge document, expand **AI data permission**. Existing content defaults to **Deny / Local only / Private**. To propose a cloud request, explicitly allow an appropriate processing boundary and choose **Ask** or **Allow**. A document and its containing space must both permit processing. Even **Allow** does not bypass the current per-run review step. Changing UI language never changes document text.

Inspect the selected route, prompt and context before approving a run. Approval binds the route fingerprint and document versions. Changing the route, deleting or editing context, or revoking access prevents a stale approved request from being sent. Model results are proposals; they never silently replace Markdown or create formal tasks.

## Execution guarantees and limitations

- The host rechecks account access, context policy, versions and route immediately before sending. Approval cannot override denied content, secret classification or a processing-location restriction.
- A versioned run receives one durable send reservation before the network side effect. Reservation and Activity/Outbox records are committed together. Duplicate dispatchers cannot send the same reservation twice.
- Cancellation and the route deadline bound execution. A timeout does not prove that a remote provider performed no work. Restarted or uncertain attempts are interrupted with an unknown outcome and are not automatically retried.
- If a provider reports valid input/output token counts, the counts are persisted with the attempt, including known consumption from a rejected response. Missing counters remain unknown, not zero. These records are not a monetary invoice.
- Integration Bearer credentials cannot configure server providers, change document AI policies or approve model sends. An AI-produced document edit preserves existing policy.

No arbitrary shell tools or provider tool calls are executed. The current public-HTTPS destination checks intentionally reject loopback and private-network endpoints; labeling a cloud route as local is not supported.

## Registry, budget and fallback in 0.0.8

Named registrations now support TEXT, JSON and EMBEDDING capabilities, explicit daily request and USD budget limits (including UNLIMITED), and up to two approved fallback profiles. The persistent ledger reserves before dispatch and reconciles reported usage; unknown usage retains the conservative reservation. Only a definitive no-send result allows fallback. Timeout or uncertain network outcomes never trigger automatic resend. Every fallback route is included in the approval and revalidated before use.

The authenticated MCP endpoint exposes workspace snapshots, additive plan previews and project document creation. It cannot publish plans or approve model sends. Shared administrator discovery, trusted private-network endpoints and arbitrary agent execution remain outside this implementation.

## Upgrades

Back up before upgrading. Context permission and attempt records are additive fields in existing entity payloads (SQLite schema 15 / PostgreSQL schema 7); no additional SQL migration is needed for these fields. Do not downgrade to an application version that ignores the new policy. Database backup/restore does not back up provider credentials. Server deployment and native-device acceptance are separate from local automated validation.

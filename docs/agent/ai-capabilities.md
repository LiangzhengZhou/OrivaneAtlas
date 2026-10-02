# Runtime AI capabilities and approval

Session 092 adds one application registry shared by Assistant and MCP. Every
call carries the authenticated workspaceId/principalId; callers cannot select
another workspace or access database adapters directly.

| Capability | Risk | Authorization / approval |
| --- | --- | --- |
| search_documents | READ | work:read; scope resolver and document/Space policy filtering |
| read_document | READ | work:read; workspace, live document and Space checks |
| get_project | READ | work:read; live project in the authorized snapshot |
| list_project_tasks | READ | work:read; live project and authorized tasks |
| create_task | WRITE | work:create; explicit human approval |
| propose_document_edit | PROPOSE | work:update; explicit human approval; returns versioned proposal, never auto-saves |
| link_documents | WRITE | work:update; explicit human approval and both authorized documents |

Host `/api/ai/capability` requires a human cookie, CSRF and idempotency key.
`approved` defaults false. Runtime REVIEW_WRITES requires approval for PROPOSE,
WRITE and DESTRUCTIVE; REVIEW_EVERYTHING also requires it for READ. There is no
current destructive capability or user-controlled policy override.

MCP registers the same seven calls alongside its compatibility tools. New calls
require a read-write integration credential (a read token cannot gain new raw
document access). MCP cannot supply an approval flag, so proposals/writes are
rejected until invoked through the explicit human-approved path. Document data
disclosed through these MCP calls requires both document and parent Space
ALLOW/ANY policies, never SECRET. Existing token revocation and actor boundaries
remain active.

Assistant retrieval executes search_documents before constructing its approval
manifest; documents are not sent until approval and repeated version/route/data
policy checks. Assistant document acceptance uses the same proposal capability
and application document mutation, with the approved run's exact version targets.
Providers currently advertise tools=false; model-produced tool calls are rejected.

Optional sessionId/sessionVersion on the human capability endpoint persists
TOOL_CALL and TOOL_RESULT or PROPOSAL in the actor-owned conversation, atomically
with application changes and Activity/Outbox. Session versions prevent stale
effects. Model request rejection, failure and restart recovery persist ERROR;
normal USER/ASSISTANT messages survive reload and Host restart.

Endpoint network trust is administrator-only and separately audited. It never
overrides these approval/data boundaries. Streaming events are temporary UI data;
durable AgentRun, session, audit and usage remain authoritative.

`project_document_create` requires explicit `spaceId` bound to the project. It never creates a Space implicitly. Existing authorization, external provenance, deny-by-default policy and idempotent request receipts remain mandatory. Note promotion/link-space are human-session commands and are not Agent tools.

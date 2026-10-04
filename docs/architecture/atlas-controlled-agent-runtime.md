# Atlas controlled agent runtime

The Atlas conversation uses `AgentHarness`, rather than a single prompt/answer
call. `ModelRouteResolver` chooses Explicit conversation override > current Space
override > current Project override > Personal default. Unset bindings inherit.
`RetrievalContextResolver` independently reuses ProjectKnowledgeScope; changing
retrieval context does not silently change the configured provider.

## Provider contracts

`ProviderConnection` owns one encrypted credential. ModelDefinition references
the connection and declares tools, JSON schema, vision, streaming and embedding.
ModelProfile selects a primary, at most two fallback models, formal UNLIMITED or
LIMITED request count, and independent USD budget. ModelBinding assigns profiles.
Application code depends only on ModelProviderAdapter. Native HTTP protocols
live in Host adapters, under the same DNS pinning, response bounds, no redirects
and explicit TrustedAiEndpoint allowlist as existing providers. Private local
Ollama/LM Studio/vLLM endpoints require an administrator allowlist.

Production protocol references consulted for this implementation:

- [OpenAI Chat](https://developers.openai.com/api/reference/resources/chat)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create),
  [authentication](https://platform.claude.com/docs/en/api/overview),
  [models](https://platform.claude.com/docs/en/api/models)
- [Gemini generation](https://ai.google.dev/api/generate-content),
  [models](https://ai.google.dev/api/models),
  [function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [DeepSeek Chat](https://api-docs.deepseek.com/api/create-chat-completion/)
- [OpenRouter](https://openrouter.ai/docs/api-reference/overview)
- [Ollama chat](https://docs.ollama.com/api/chat),
  [model listing](https://docs.ollama.com/api/tags)
- [LM Studio compatibility](https://lmstudio.ai/docs/developer/openai-compat)
- [vLLM tools](https://docs.vllm.ai/en/latest/features/tool_calling/)

Native tool adapters currently declare streaming and embedding false where the
runtime does not implement those paths. Legacy OpenAI Chat/Responses streaming
remains supported. Discovery is bounded; manual model entry and explicit model
capability configuration support providers without discovery. Model IDs alone
do not guarantee a provider supports every feature. Signed Anthropic/Gemini
reasoning blocks remain opaque adapter data and round-trip with tool results.
Fallback never retries an uncertain sent request; only a confirmed not-sent or
unsupported native-tool route can advance to another approved candidate.

## Approval, limits and durable execution

Canonical CapabilityRegistry supplies schema, description, risk and execution to
MCP and Atlas. Legacy MCP-only workspace/project aliases remain compatibility
operations. All business execution passes AiCapabilityService and existing
Work/Library/Workflow services, versions and authorization. A model cannot supply
`approved` or invent a tool. Non-native adapters return a strict validated JSON
FINAL/ACTION envelope; no natural-language regular-expression tool detection.

Defaults cap eight model steps, twelve tool calls, five writes, 120 seconds of
active execution and 64,000 context characters. Human waiting time does not
consume execution time. Each additional provider step receives a durable child
AgentRun reservation, counting request limits and budget. Failed child calls are
settled without replay. Provider-reported usage is distinguished from unknown
usage and configured-price estimates are not invoices.

Read operations follow disclosure policy. Writes require real human review.
Private `preview_plan` validates without publishing; `publish_plan` always needs
human approval, even AUTO_SAFE. Review can edit a manifest before publication.
Task creation and the corresponding TOOL_CALL/TOOL_RESULT plus resume checkpoint
commit together. Restart preserves pending review; in-flight unknown sends are
interrupted rather than blindly replayed. Approval binds run, session, context
and route versions. A changed context rejects stale approval. The human can stop
a waiting run without executing any tool, including after context changes.

## Conversation and evidence

Original conversation messages remain the audit source. Prompt construction
uses bounded recent successful conversation messages, not the whole workspace
or an unlimited session. Selected/retrieved document excerpts and tool results
are bounded. There is no rolling summary replacing original audit messages.
Sources are actual versioned Host retrieval/context metadata persisted per answer;
model-produced titles or links never become authoritative Sources. Starters fill
the prompt only. Tool actions, results, diffs and reviewed plans have structured UI.

## Persistence compatibility

Vault reads the 2.0.2 encrypted array and writes encrypted format 2 atomically with
owner-scoped compare-and-swap. Catalog projection retains default/WORK/SPACE,
fallback, disabled profiles, Unlimited and encrypted credentials. Credentials
are centralized and never returned. Vault/key remain separate from DB backups.
AgentRun harness/approval and AgentSession evidence use existing JSON payloads
in both adapters; older payloads omit optional fields safely. SQLite migration
0027 and PostgreSQL 0020 add the recurrence conversion event while preserving
existing Activity/Outbox data and versions.

## Workspace invalidation

Browser SSE sends only host-epoch/workspace-revision cursor invalidations after a
committed write. It is an in-memory single-host notification mechanism, not a
durable DB event log or full synchronization protocol. HTTP, MCP and background
worker writes use the same unit-of-work boundary. Client coalesces pulls, ignores
duplicate events, disconnects when hidden/offline, and pulls on resume/reconnect.
Authorization is rechecked on heartbeat. Native and disconnected clients have a
bounded polling fallback. External processes writing the DB directly are outside
this event mechanism; foreground refresh/reconnect still recovers state.

## Native validation boundary

Master branding lives only in branding/application-icon-source.png; the reproducible
generator derives Windows sizes, Android adaptive/legacy and notification assets.
Build and resource tests do not establish physical Android launcher, Windows
Explorer/shortcut/taskbar behavior, or live paid provider acceptance. Those require
devices and actual provider credentials and are recorded separately from mocks.

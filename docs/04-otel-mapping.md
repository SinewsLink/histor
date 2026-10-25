# OpenTelemetry Mapping (v0.1)

Histor is designed to **extend** OpenTelemetry's GenAI semantic conventions, not compete with them. A receipt can ride on an OTel span event or log record, and existing OTel GenAI attributes map onto Histor fields.

## Carrying receipts in OTel
- Emit a **log record** (preferred) or **span event** named `histor.receipt` on the span of the action.
- Attribute `histor.receipt` = the sealed receipt JSON (string).
- Index attributes for search and sampling decisions (never sample medium+ consequence; spec §3.1):

| Attribute | From |
|---|---|
| `histor.version` | `histor_version` |
| `histor.receipt_id` | `receipt_id` |
| `histor.kind` | `kind` |
| `histor.stream_id` / `histor.sequence` | `chain.*` |
| `histor.content_hash` | `seal.content_hash` |
| `histor.principal.id` | `principal.subject_id` |
| `histor.consequence` | `action.consequence` |
| `histor.approval.status` | `approval.status` |
| `histor.cost.amount` / `histor.cost.currency` | `cost.amount` / `cost.currency` |

## OTel GenAI → Histor
Attribute names follow the OTel GenAI semantic conventions as of 2026. These conventions are still evolving, so check the current registry when implementing.

| OTel attribute | Histor field |
|---|---|
| `gen_ai.provider.name` (older: `gen_ai.system`) | `cost.usage[].provider`, `agent.model.provider` |
| `gen_ai.request.model` / `gen_ai.response.model` | `agent.model.model_id`, `cost.usage[].model` (use the **response** model for pricing) |
| `gen_ai.operation.name` | `action.category` (`chat`/`invoke_agent` → model_call; `execute_tool` → tool_call) |
| `gen_ai.usage.input_tokens` | `buckets.input_tokens` **after normalization** (provider semantics differ; spec §4.11) |
| `gen_ai.usage.output_tokens` | `buckets.output_tokens` |
| cache token attributes (where your SDK emits them) | `buckets.cache_read_tokens`, `buckets.cache_write_tokens.*`. If absent, add `histor.usage.cache_read_tokens` / `histor.usage.cache_write_5m_tokens` / `histor.usage.cache_write_1h_tokens` |
| `gen_ai.tool.name` / `gen_ai.tool.call.id` | `action.tool.tool_name` / `trace.tool_use_id` |
| `gen_ai.agent.id` / `gen_ai.agent.name` | `agent.agent_id` / `agent.name` |
| `gen_ai.conversation.id` | `session.conversation_id` |
| `trace_id` / `span_id` | `trace.trace_id` / `trace.span_id` |

**Never** copy `gen_ai.input.messages` / `gen_ai.output.messages` (prompt/completion content) into receipts. Commit to them instead.

## ACS (OWASP Agent Control Standard) hook → Histor receipt (draft)
ACS defines *where* controls run; Histor records *what happened* at each point, in a form a third party can verify. Draft mapping, to be confirmed against the published ACS spec:

| ACS hook | Histor receipt | Notes |
|---|---|---|
| session start / session end | `session.start` / `session.end` | include agent bill-of-materials hash in `agent.config_hash` |
| user message | none by default (commit only if policy requires) | never store content; `intent.user_request_commitment` on the next action |
| tool call (pre) | `denial` if blocked; nothing if allowed | the decision lands in `authorization` |
| tool call (post) | `action` | outcome, output commitment, approval binding |
| memory read / write | `action` with `category` data_read / data_write | resource classification |
| knowledge retrieval | `action` (data_read) | `resources[]` with classification |
| subagent spawn | `delegation` | scope narrowing per hop |
| response | `model.call` (cost) | four-bucket usage |
| agent BOM change | `agent.change` | tool-surface diff |

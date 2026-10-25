# Field Mapping Checklist (Histor v0.1)

Mark each: mapped (source attribute) / derived (how) / not available.

**Envelope:** kind · issued_at (source event time vs emit time; record emit time, keep source time in trace if different)
**issuer:** type · software name/version · host · key_id
**tenant:** org_id · environment · deployment_id · region · data_residency
**principal:** subject_id · idp · authenticated · auth.method · assurance_level · role
**agent:** agent_id (stable) · name · version · build_hash · framework · owner · model {provider, model_id (response model), region} · system_prompt_commitment · config_hash · parent_agent_id
**session:** session_id · protocol · protocol_version · conversation_id · run_id · step_index
**trace:** trace_id/span_id/parent_span_id (W3C) · traceparent · jsonrpc_id · tool_use_id · gateway_request_id
**delegation[]:** from · to · scope · granted_at · expires_at · grant_ref · depth
**action:** category · tool {protocol, server_name, server_version, tool_name, tool_definition_hash, annotations} · input {commitment, size_bytes, secret_scan, classification} · payload_commitment · intent · consequence · reversibility · idempotency_key · retry_of_receipt_id
**resources[]:** type · identifier_commitment · classification · pii_categories · access_mode · records_affected · jurisdiction
**credentials[]:** credential_id (no secrets!) · type · issuer · scopes · owner · granted_by · issued/expires · just_in_time · exposure {secret_material_in_model_context, placeholder_used, reached_sinks[]}
**authorization:** decision · rule_id · allowed_by_default · policy {engine, id, version, hash} · evaluated_at · enforcer
**approval:** required · status · approval_id · request_id · approvers[] {approver, method, decision, decided_at, expires_at, decision_latency_ms, approved_payload_commitment, evidence_ref} · quorum · separation_of_duties · break_glass
**cost:** currency · usage[] {provider, model, requests, buckets (normalized!), tool_fees, amount, lines, service_tier, region, batch} · amount · method · pricing_ref · allocation · source · reconciliation
**outcome:** status · started_at · ended_at · duration_ms · output {commitment, size_bytes, secret_scan} · error {code, message_commitment} · side_effects[] · compensating_action_receipt_id
**risk / compliance / privacy / links / extensions** as applicable.

Provider cost traps to check for every new provider: does "input" include cached tokens? Are cache writes billed at a premium, and by TTL? Are reasoning tokens in output? Long-context tiers? Batch discounts? Billed failures? Per-request tool fees?

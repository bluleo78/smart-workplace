-- V88: 채팅 L3 위임 — AI 가 채널/스레드에서 제안한 쓰기 행동(현재 이슈 생성)을 per-메시지로 영속.
-- 제안 카드 1개 = 메시지 1개(message_id UNIQUE). 위임자(proposed_by_user_id)만 승인/거부.
-- 승인 시 status=CONFIRMED + result_issue_key, 거부 시 REJECTED. tenant_id + FORCE RLS 로 테넌트 격리.
CREATE TABLE message_action_proposal (
  id                   BIGSERIAL   PRIMARY KEY,
  message_id           BIGINT      NOT NULL UNIQUE,
  channel_id           BIGINT      NOT NULL,
  proposed_by_user_id  BIGINT      NOT NULL,
  action_type          TEXT        NOT NULL,
  payload              JSONB       NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'PENDING',
  result_issue_key     TEXT,
  resolved_by          BIGINT,
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id            BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
);

CREATE INDEX idx_message_action_proposal_channel ON message_action_proposal (channel_id, tenant_id);

ALTER TABLE message_action_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_action_proposal FORCE ROW LEVEL SECURITY;
CREATE POLICY message_action_proposal_tenant_isolation ON message_action_proposal
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

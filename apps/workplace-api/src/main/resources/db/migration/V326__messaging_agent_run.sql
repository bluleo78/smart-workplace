-- WP-1979: 메시징 AI 대화별 실행 임대(messaging_agent_run). ai-agent 가 여러 대여도 같은 (채널, 스레드, AI) 대화의 실행이 하나만 돌게
-- 하는 DB 임대 행. 실행 중에 온 더 새 메시지는 pending 한 칸에 최신만 남기고, 실행이 끝나면 그 이벤트를 받아 이어서 돌린다.
CREATE TABLE messaging_agent_run (
  tenant_id               BIGINT       NOT NULL
                            DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                            REFERENCES tenant(id),
  channel_id              BIGINT       NOT NULL,
  parent_message_id       BIGINT       NOT NULL,
  agent_id                BIGINT       NOT NULL,
  owner_token             UUID,
  lease_until             TIMESTAMPTZ,
  last_started_message_id BIGINT       NOT NULL DEFAULT 0,
  pending_message_id      BIGINT,
  pending_event           JSONB,
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, parent_message_id, agent_id)
);

COMMENT ON TABLE  messaging_agent_run IS '메시징 AI 대화별 실행 임대 — (채널, 스레드, AI) 하나당 한 행';
COMMENT ON COLUMN messaging_agent_run.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN messaging_agent_run.channel_id IS '채널 ID';
COMMENT ON COLUMN messaging_agent_run.parent_message_id IS '스레드 부모 메시지 ID(인라인 멘션처럼 스레드가 없으면 0)';
COMMENT ON COLUMN messaging_agent_run.agent_id IS '응답하는 AI 구성원 ID';
COMMENT ON COLUMN messaging_agent_run.owner_token IS '지금 실행을 쥔 쪽의 토큰(NULL 이면 실행 중 아님)';
COMMENT ON COLUMN messaging_agent_run.lease_until IS '임대 만료 시각(지나면 다른 쪽이 넘겨받을 수 있다)';
COMMENT ON COLUMN messaging_agent_run.last_started_message_id IS '마지막으로 실행을 시작한 메시지 ID(이 이하는 중복으로 무시)';
COMMENT ON COLUMN messaging_agent_run.pending_message_id IS '실행 중에 도착해 기다리는 최신 메시지 ID';
COMMENT ON COLUMN messaging_agent_run.pending_event IS '기다리는 메시지의 이벤트 본문(JSON, 실행이 끝나면 그대로 돌려준다)';
COMMENT ON COLUMN messaging_agent_run.updated_at IS '마지막 변경 시각';

-- RLS: V324 ai_capacity_sample 과 같은 형(NULLIF fail-closed). 시퀀스는 없다.
ALTER TABLE messaging_agent_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_agent_run FORCE ROW LEVEL SECURITY;
CREATE POLICY messaging_agent_run_tenant_isolation ON messaging_agent_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON messaging_agent_run TO app_tenant;

-- WP-1986: 서버가 돌리는(INTERNAL) AI 의 이슈 실행 중 아직 도는 것 — ai-agent 가 실행마다 만든 run_id 를 STARTED 에 넣고 FINISHED 에 지운다.
-- 끝 보고가 「그 AI 의 마지막 도는 실행」의 끝인지 가려, 다음 노드의 새 실행·이슈 댓글로 깨어난 실행이 도는 동안 옛 실행의 끝이 작업을 쉬는 중으로 내리지 않게 한다.
-- 새 표만 더한다(expand 호환 — 옛 ai-agent 는 run_id 를 보내지 않아 행이 생기지 않는다).
CREATE TABLE agent_server_run (
  tenant_id  BIGINT      NOT NULL
               DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
               REFERENCES tenant(id),
  issue_id   BIGINT      NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  agent_id   BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  run_id     UUID        NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, agent_id, run_id)
);

CREATE INDEX idx_agent_server_run_tenant ON agent_server_run (tenant_id);
CREATE INDEX idx_agent_server_run_agent ON agent_server_run (agent_id);

COMMENT ON TABLE  agent_server_run IS '서버 AI 의 도는 이슈 실행 — STARTED 에 넣고 FINISHED 에 지운다(끝 보고가 마지막 도는 실행의 것인지 가르는 데 쓴다)';
COMMENT ON COLUMN agent_server_run.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN agent_server_run.issue_id IS '실행 대상 이슈(이슈가 지워지면 함께 지워짐)';
COMMENT ON COLUMN agent_server_run.agent_id IS '실행한 AI 사용자(사용자가 지워지면 함께 지워짐)';
COMMENT ON COLUMN agent_server_run.run_id IS 'ai-agent 가 실행마다 만든 id(UUID)';
COMMENT ON COLUMN agent_server_run.started_at IS 'STARTED 를 받은 서버 시각(오래 남은 행을 도는 실행으로 세지 않는 데 쓴다)';

-- RLS: V334 와 같은 형(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE agent_server_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_server_run FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_server_run_tenant_isolation ON agent_server_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 테넌트 영구 삭제(TenantPurgePlan)가 DELETE 를 요구하므로 DELETE 도 준다.
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_server_run TO app_tenant;

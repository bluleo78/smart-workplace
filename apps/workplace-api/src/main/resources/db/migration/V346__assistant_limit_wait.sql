-- WP-2108: AI 비서가 쓰는 자격(ai_agent_credential)이 사용 한도에 걸렸을 때 풀리는 시각까지 비서 호출을 건너뛰고 한 번만 알리기 위한 대기 표.
-- 대기 단위는 자격 한 건(테넌트별로 따로 — 같은 자격이 여러 테넌트의 비서로 쓰일 수 있다). 새 표만 더한다(expand 호환).
CREATE TABLE assistant_limit_wait (
  tenant_id     BIGINT      NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id),
  credential_id BIGINT      NOT NULL REFERENCES ai_agent_credential(id) ON DELETE CASCADE,
  agent_user_id BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  until_at      TIMESTAMPTZ NOT NULL,
  notified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, credential_id)
);

CREATE INDEX idx_assistant_limit_wait_agent ON assistant_limit_wait (agent_user_id);

COMMENT ON TABLE  assistant_limit_wait IS '비서 자격의 사용 한도 대기 — until_at 까지 비서 호출을 건너뛰고, 대기가 시작될 때 한 번만 알린다';
COMMENT ON COLUMN assistant_limit_wait.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN assistant_limit_wait.credential_id IS '한도에 걸린 비서 자격(자격이 지워지면 함께 지워짐)';
COMMENT ON COLUMN assistant_limit_wait.agent_user_id IS '마지막으로 걸린 비서 AGENT 사용자(알림 수신자를 정하는 데 쓴다. 사용자가 지워지면 함께 지워짐)';
COMMENT ON COLUMN assistant_limit_wait.until_at IS '대기가 풀리는 시각(다시 걸리면 더 늦은 쪽으로 늘어난다)';
COMMENT ON COLUMN assistant_limit_wait.notified_at IS '이 대기를 알린 시각(대기가 새로 시작될 때 갱신)';
COMMENT ON COLUMN assistant_limit_wait.created_at IS '행을 처음 만든 시각';

-- RLS: V337 과 같은 형(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE assistant_limit_wait ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_limit_wait FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_limit_wait_tenant_isolation ON assistant_limit_wait
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 테넌트 영구 삭제(TenantPurgePlan)가 DELETE 를 요구하므로 DELETE 도 준다.
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_limit_wait TO app_tenant;

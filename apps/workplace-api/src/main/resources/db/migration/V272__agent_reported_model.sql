-- V272 (WP-1297): AI 가 보고한 「로그인 계정(ChatGPT·Gen:iA)의 모델 목록」(agent_reported_model).
--
-- ChatGPT 로그인 계정은 access token 수명이 10일이고 refresh token 이 1회용(회전)이라, Works 서버가 저장된 로그인으로 모델 목록을 조회하려
-- 갱신하면 Pod 안 프로그램의 로그인이 풀린다. 그래서 목록은 Pod 가 자기 AI 키로 Works 에 보고하고(PUT /agent-runtime/me/models)
-- 서버는 저장해 둔 보고만 돌려준다. 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- 테넌트 테이블 — V248(agent_location)의 테넌트 패턴(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
--   - AI(테넌트·agent_user_id)당 보고는 하나 — 다시 보고하면 덮어쓴다(PK).
--   - credential_id: 보고 당시의 활성 연결 행 id. 조회는 지금 활성 행 id 와 같을 때만 이 목록을 쓴다 — 연결을 바꾸면(새 행) 옛 보고는 저절로
--     무시되고, 연결 행이 지워지면 함께 지운다(CASCADE).
--   - models: [{id,label,efforts:[…]}] — 서비스가 꼴을 검증한 값만 들어온다.

CREATE TABLE agent_reported_model (
  tenant_id      BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  agent_user_id  BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credential_id  BIGINT      NOT NULL REFERENCES ai_agent_credential(id) ON DELETE CASCADE,
  models         JSONB       NOT NULL,
  reported_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_user_id),
  CONSTRAINT fk_agent_reported_model_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_agent_reported_model_credential ON agent_reported_model(credential_id);

ALTER TABLE agent_reported_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_reported_model FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_reported_model_tenant_isolation ON agent_reported_model
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

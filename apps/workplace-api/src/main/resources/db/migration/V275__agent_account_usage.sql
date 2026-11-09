-- V275 (WP-1449): AI 계정 사용량 스냅샷 — provider 에 직접 물어 얻은 5시간·주간 사용률의 "최신 값"만 계정당 창마다 한 행으로 둔다.
--
-- 새 테이블만 더한다(롤링 배포 호환: 옛 코드는 이 테이블을 모른다). V274(agent_account)와 같은 RLS 정책 모양.
--   - agent_account_usage: 계정 × 창(5h·7d) 최신 사용률. 응답에 일부 창만 있으면 있는 창만 갱신한다(없는 창은 이전 값 유지).
--   - agent_account_usage_check: 계정당 조회 기록 한 행 — 마지막 시도/성공 시각, 한도 도달, 실패 이유, 중복 조회를 막는 임대(lease),
--     runner 가 알린 마지막 사용 시각. 실패해도 스냅샷은 건드리지 않고 이 행만 갱신한다.
-- 계정이 지워지면(ON DELETE CASCADE) 같이 사라진다.

CREATE TABLE agent_account_usage (
  tenant_id    BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  account_id   BIGINT       NOT NULL REFERENCES agent_account(id) ON DELETE CASCADE,
  window_key   VARCHAR(8)   NOT NULL CHECK (window_key IN ('5h', '7d')),
  used_percent NUMERIC(5,2) NOT NULL,
  resets_at    TIMESTAMPTZ,
  limit_status VARCHAR(32),
  observed_at  TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY (account_id, window_key),
  CONSTRAINT fk_agent_account_usage_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_agent_account_usage_tenant ON agent_account_usage(tenant_id);

ALTER TABLE agent_account_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_account_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_account_usage_tenant_isolation ON agent_account_usage
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

CREATE TABLE agent_account_usage_check (
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  account_id    BIGINT       PRIMARY KEY REFERENCES agent_account(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ,
  succeeded_at  TIMESTAMPTZ,
  limit_reached BOOLEAN      NOT NULL DEFAULT false,
  error_code    VARCHAR(32),
  error_message VARCHAR(200),
  lease_until   TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  CONSTRAINT fk_agent_account_usage_check_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_agent_account_usage_check_tenant ON agent_account_usage_check(tenant_id);

ALTER TABLE agent_account_usage_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_account_usage_check FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_account_usage_check_tenant_isolation ON agent_account_usage_check
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

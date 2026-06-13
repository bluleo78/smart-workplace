-- V66: home AI / assistant 도메인 4개 테이블 RLS 활성화.
--   대상: home_session / home_message / assistant_config / workspace_assistant
-- V48/V62/V64 와 동일한 NULLIF fail-closed 패턴 사용:
--   NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   → GUC 미설정(NULL) 또는 빈 문자열('')이면 NULL 로 환산 → 비가시(fail-closed).
-- 강제는 app_tenant 런타임에만 적용됨 (소유자 app 은 BYPASSRLS 권한 보유).

-- ============================================================
-- 1) home_session
-- ============================================================
ALTER TABLE home_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY home_session_tenant_isolation ON home_session
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 2) home_message
-- ============================================================
ALTER TABLE home_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY home_message_tenant_isolation ON home_message
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 3) assistant_config
-- ============================================================
ALTER TABLE assistant_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_config_tenant_isolation ON assistant_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 4) workspace_assistant
-- ============================================================
ALTER TABLE workspace_assistant ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_assistant_tenant_isolation ON workspace_assistant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

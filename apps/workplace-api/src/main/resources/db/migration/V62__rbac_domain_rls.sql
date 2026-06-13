-- V62: RBAC 도메인 3개 테이블(role / role_permission / user_role) RLS 활성화.
-- V48 과 동일한 NULLIF fail-closed 패턴 사용:
--   NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   → GUC 미설정(NULL) 또는 빈 문자열('')이면 NULL 로 환산 → 비가시(fail-closed).
-- 강제는 app_tenant 런타임에만 적용됨 (소유자 app 은 BYPASSRLS 권한 보유).
-- permission 은 전역 코드 카탈로그 → RLS 없음.

-- ============================================================
-- 1) role
-- ============================================================
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_tenant_isolation ON role
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 2) role_permission
-- ============================================================
ALTER TABLE role_permission ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permission_tenant_isolation ON role_permission
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 3) user_role
-- ============================================================
ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_role_tenant_isolation ON user_role
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

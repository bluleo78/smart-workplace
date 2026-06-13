-- V53: file·drive 도메인 5개 테이블 RLS(Row Level Security) 활성화.
-- V48(issue)/V50(messaging) 과 동일한 NULLIF fail-closed 패턴:
--   tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   → GUC 미설정(NULL) 또는 빈 문자열('')이면 NULL 로 환산 → 어떤 행과도 매칭 안 됨(fail-closed, 비가시).
-- 강제는 비특권 런타임 롤(app_tenant)에만 적용된다(소유자 app 은 BYPASSRLS 보유 → 마이그레이션/코드젠 영향 없음).
-- USING(읽기/UPDATE·DELETE 대상 가시성) + WITH CHECK(INSERT/UPDATE 결과 행 검증) 둘 다 설정.

-- ============================================================
-- 1) file
-- ============================================================
ALTER TABLE file ENABLE ROW LEVEL SECURITY;
CREATE POLICY file_tenant_isolation ON file
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 2) drive_space
-- ============================================================
ALTER TABLE drive_space ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_space_tenant_isolation ON drive_space
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 3) drive_space_member
-- ============================================================
ALTER TABLE drive_space_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_space_member_tenant_isolation ON drive_space_member
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 4) drive_folder
-- ============================================================
ALTER TABLE drive_folder ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_folder_tenant_isolation ON drive_folder
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 5) drive_file
-- ============================================================
ALTER TABLE drive_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_file_tenant_isolation ON drive_file
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

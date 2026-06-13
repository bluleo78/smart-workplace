-- V55: audit·notify 도메인 2개 테이블 RLS(Row Level Security) 활성화.
-- V48(issue)/V50(messaging)/V53(file·drive) 과 동일한 NULLIF fail-closed 패턴:
--   tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   → GUC 미설정(NULL) 또는 빈 문자열('')이면 NULL 로 환산 → 어떤 행과도 매칭 안 됨(fail-closed, 비가시).
-- 강제는 비특권 런타임 롤(app_tenant)에만 적용된다(소유자 app 은 BYPASSRLS 보유 → 마이그레이션/코드젠 영향 없음).
-- USING(읽기/UPDATE·DELETE 대상 가시성) + WITH CHECK(INSERT/UPDATE 결과 행 검증) 둘 다 설정.

-- ============================================================
-- 1) notification (표준 — NOT NULL 이므로 표준 WITH CHECK)
-- ============================================================
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_tenant_isolation ON notification
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 2) audit_log (WITH CHECK 에 `OR tenant_id IS NULL` 필수)
-- ============================================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

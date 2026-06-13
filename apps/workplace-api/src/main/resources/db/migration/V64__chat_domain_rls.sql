-- V64: chat 도메인 3개 테이블(chat_thread / chat_thread_member / chat_message) RLS 활성화.
-- V48/V62 와 동일한 NULLIF fail-closed 패턴 사용:
--   NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   → GUC 미설정(NULL) 또는 빈 문자열('')이면 NULL 로 환산 → 비가시(fail-closed).
-- 강제는 app_tenant 런타임에만 적용됨 (소유자 app 은 BYPASSRLS 권한 보유).

-- ============================================================
-- 1) chat_thread
-- ============================================================
ALTER TABLE chat_thread ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_thread_tenant_isolation ON chat_thread
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 2) chat_thread_member
-- ============================================================
ALTER TABLE chat_thread_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_thread_member_tenant_isolation ON chat_thread_member
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 3) chat_message
-- ============================================================
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_message_tenant_isolation ON chat_message
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

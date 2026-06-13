-- V59: calendar·mail·contacts 도메인 11개 테이블 RLS 활성화.
-- V48 표준 NULLIF fail-closed 패턴 사용:
--   NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   → GUC 미설정(NULL) 또는 빈 문자열('')이면 NULL 로 환산 → 비가시(fail-closed).
-- 11개 모두 tenant_id NOT NULL 표준 정책(audit_log 의 nullable 변형 아님).
-- 강제는 app_tenant 런타임에만 적용됨 (소유자 app 은 BYPASSRLS 권한 보유).

-- ============================================================
-- calendar
-- ============================================================

-- 1) calendar_event
ALTER TABLE calendar_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_event_tenant_isolation ON calendar_event
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 2) event_reminder
ALTER TABLE event_reminder ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_reminder_tenant_isolation ON event_reminder
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 3) calendar_event_exception
ALTER TABLE calendar_event_exception ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_event_exception_tenant_isolation ON calendar_event_exception
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- mail
-- ============================================================

-- 4) email_account
ALTER TABLE email_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_account_tenant_isolation ON email_account
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 5) email_folder
ALTER TABLE email_folder ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_folder_tenant_isolation ON email_folder
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 6) email_message
ALTER TABLE email_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_message_tenant_isolation ON email_message
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 7) email_attachment
ALTER TABLE email_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_attachment_tenant_isolation ON email_attachment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- contacts
-- ============================================================

-- 8) contact_entry
ALTER TABLE contact_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_entry_tenant_isolation ON contact_entry
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 9) contact_favorite
ALTER TABLE contact_favorite ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_favorite_tenant_isolation ON contact_favorite
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 10) user_group
ALTER TABLE user_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_group_tenant_isolation ON user_group
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 11) user_group_member
ALTER TABLE user_group_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_group_member_tenant_isolation ON user_group_member
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

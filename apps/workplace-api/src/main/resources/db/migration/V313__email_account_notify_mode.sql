-- 계정 새 메일 알림 범위 ALL|WORK|OFF — WP-1739
ALTER TABLE email_account
  ADD COLUMN notify_mode VARCHAR(4) NOT NULL DEFAULT 'WORK';
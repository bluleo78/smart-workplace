-- M365 Graph 등 OAuth 공급자 수용(#499). 기존 IMAP 계정은 provider='IMAP' 기본값으로 무영향.
ALTER TABLE email_account
  ADD COLUMN provider               VARCHAR(32) NOT NULL DEFAULT 'IMAP',  -- IMAP | M365_GRAPH
  ADD COLUMN oauth_refresh_token    TEXT,         -- 암호화(EncryptionService). 갱신 때마다 회전 저장
  ADD COLUMN oauth_access_token     TEXT,         -- 암호화. 단기 캐시
  ADD COLUMN oauth_token_expires_at TIMESTAMPTZ;  -- access_token 만료 시각

-- OAuth 계정은 IMAP/SMTP 접속정보·비밀번호가 없다 → 해당 컬럼을 nullable 로 완화(앱계층에서 provider=IMAP 일 때만 필수).
ALTER TABLE email_account
  ALTER COLUMN imap_host          DROP NOT NULL,
  ALTER COLUMN imap_port          DROP NOT NULL,
  ALTER COLUMN imap_security      DROP NOT NULL,
  ALTER COLUMN imap_username      DROP NOT NULL,
  ALTER COLUMN smtp_host          DROP NOT NULL,
  ALTER COLUMN smtp_port          DROP NOT NULL,
  ALTER COLUMN smtp_security      DROP NOT NULL,
  ALTER COLUMN smtp_username      DROP NOT NULL,
  ALTER COLUMN encrypted_password DROP NOT NULL;

-- Graph 메시지의 안정 키(delta 중복제거 + 본문 on-demand 재조회). IMAP 행은 NULL.
ALTER TABLE email_message ADD COLUMN provider_message_id TEXT;
CREATE UNIQUE INDEX uk_email_message_provider_msg
  ON email_message(account_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Graph 증분 동기화 커서(@odata.deltaLink). IMAP 은 uid_validity/last_seen_uid 사용, Graph 는 이 컬럼 사용.
ALTER TABLE email_folder ADD COLUMN delta_link TEXT;

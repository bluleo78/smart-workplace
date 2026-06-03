-- 외부 이메일 계정(IMAP/SMTP) — 개인 메일함 연동(에픽 #67 / #68).
-- 비밀번호는 EncryptionService(AES-256-GCM) 출력("Base64(iv):Base64(ct)")으로 저장한다.
CREATE TABLE email_account (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email_address      VARCHAR(320) NOT NULL,        -- 표시·발신 주소
  display_name       VARCHAR(120),                 -- 발신자 이름(선택)
  -- IMAP(수신)
  imap_host          VARCHAR(255) NOT NULL,
  imap_port          INT NOT NULL,
  imap_security      VARCHAR(16) NOT NULL,         -- SSL_TLS | STARTTLS | NONE
  imap_username      VARCHAR(320) NOT NULL,
  -- SMTP(발신)
  smtp_host          VARCHAR(255) NOT NULL,
  smtp_port          INT NOT NULL,
  smtp_security      VARCHAR(16) NOT NULL,
  smtp_username      VARCHAR(320) NOT NULL,
  -- 크리덴셜(IMAP·SMTP 공용)
  encrypted_password TEXT NOT NULL,
  -- 상태
  last_tested_at     TIMESTAMPTZ,                  -- 마지막 연결 테스트 성공 시각
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at        TIMESTAMPTZ                   -- soft delete/비활성
);
CREATE UNIQUE INDEX uq_email_account_user_addr
  ON email_account(user_id, email_address) WHERE disabled_at IS NULL;
CREATE INDEX idx_email_account_user ON email_account(user_id);

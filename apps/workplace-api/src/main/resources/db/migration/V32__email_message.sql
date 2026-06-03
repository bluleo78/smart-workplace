-- 받은편지함 동기화(#69): 폴더 · 메시지(헤더+본문) · 첨부 메타.
-- v1은 INBOX 한 폴더만 사용하지만 스키마는 다폴더 확장 가능. 첨부 바이너리는 미저장.

-- 폴더(메일박스). IMAP UIDVALIDITY/UID 증분 동기화 상태를 들고 있다.
CREATE TABLE email_folder (
  id            BIGSERIAL PRIMARY KEY,
  account_id    BIGINT NOT NULL REFERENCES email_account(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,            -- 'INBOX'
  uid_validity  BIGINT,                            -- IMAP UIDVALIDITY (변하면 UID 전부 무효)
  last_seen_uid BIGINT NOT NULL DEFAULT 0,         -- 마지막으로 동기화한 IMAP UID
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

-- 메시지(헤더 + 본문). thread_id 는 루트 Message-ID 문자열 그룹키.
CREATE TABLE email_message (
  id              BIGSERIAL PRIMARY KEY,
  account_id      BIGINT NOT NULL REFERENCES email_account(id) ON DELETE CASCADE,
  folder_id       BIGINT NOT NULL REFERENCES email_folder(id) ON DELETE CASCADE,
  imap_uid        BIGINT NOT NULL,                 -- 폴더 내 IMAP UID (증분 키)
  message_id      VARCHAR(998),                    -- RFC Message-ID 헤더(null 가능)
  thread_id       VARCHAR(998) NOT NULL,           -- 스레드 그룹키 = 루트 Message-ID
  in_reply_to     VARCHAR(998),
  mail_references TEXT,                             -- References 헤더("references"는 PG 예약어 → 회피)
  from_address    VARCHAR(320),
  from_name       VARCHAR(255),
  to_addresses    TEXT,
  cc_addresses    TEXT,
  subject         VARCHAR(998),
  sent_at         TIMESTAMPTZ,
  received_at     TIMESTAMPTZ,
  seen            BOOLEAN NOT NULL DEFAULT FALSE,   -- 서버 \Seen 스냅샷(표시용)
  has_attachment  BOOLEAN NOT NULL DEFAULT FALSE,
  body_text       TEXT,
  body_html       TEXT,
  snippet         VARCHAR(280),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, folder_id, imap_uid)
);
CREATE INDEX idx_email_message_thread   ON email_message(account_id, thread_id);
CREATE INDEX idx_email_message_received ON email_message(account_id, received_at DESC);

-- 첨부 메타데이터만(바이너리 미저장 — 다운로드는 후속).
CREATE TABLE email_attachment (
  id           BIGSERIAL PRIMARY KEY,
  message_id   BIGINT NOT NULL REFERENCES email_message(id) ON DELETE CASCADE,
  filename     VARCHAR(512),
  content_type VARCHAR(255),
  size_bytes   BIGINT,
  content_id   VARCHAR(255)
);
CREATE INDEX idx_email_attachment_message ON email_attachment(message_id);

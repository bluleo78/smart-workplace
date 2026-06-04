-- 보낸편지함(작성+발송, #70) 지원.
-- 1) 로컬에서 작성한 SENT 행은 서버 IMAP UID 가 없다(서버 Sent 폴더를 역동기화하지 않음).
--    Postgres 는 NULL 을 서로 distinct 로 취급하므로 기존 UNIQUE(account_id, folder_id, imap_uid)
--    제약과 충돌하지 않는다.
ALTER TABLE email_message ALTER COLUMN imap_uid DROP NOT NULL;

-- 2) 숨은참조(Bcc) — 전송 MIME 헤더엔 절대 넣지 않고, 보낸편지함 표시용으로 SENT 행에만 채운다.
--    인바운드 메시지엔 항상 NULL.
ALTER TABLE email_message ADD COLUMN bcc_addresses TEXT;

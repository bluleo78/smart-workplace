-- WP-148: 로컬 열람 후 원본 서버(IMAP/Graph) 읽음 반영이 끝나기 전에는 동기화가 seen 을 덮어쓰지 않도록 하는 표시.
ALTER TABLE email_message ADD COLUMN seen_push_pending BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN email_message.seen_push_pending IS '로컬 열람 후 원본 서버 반영 대기 — true 인 동안 동기화가 seen 을 덮어쓰지 않음 (WP-148)';

-- V28__messaging_attachment.sql
-- 메시지 파일 첨부 정션. file_id PK 로 파일 1개=메시지 1개 강제.
CREATE TABLE message_attachment (
  file_id     BIGINT PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  message_id  BIGINT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  attached_by BIGINT NOT NULL REFERENCES "user"(id),
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_message_attachment_message ON message_attachment(message_id);

-- 첨부만 있는 메시지 허용: body 를 nullable 로 완화(길이 상한만 유지).
ALTER TABLE message ALTER COLUMN body DROP NOT NULL;
ALTER TABLE message DROP CONSTRAINT IF EXISTS message_body_check;
ALTER TABLE message ADD CONSTRAINT message_body_check
  CHECK (body IS NULL OR length(body) <= 4000);

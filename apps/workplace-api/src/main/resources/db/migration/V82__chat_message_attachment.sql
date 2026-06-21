-- V81__chat_message_attachment.sql
-- 이슈 컨텍스트 채팅 메시지 파일 첨부 정션. file_id PK 로 파일 1개=메시지 1개 강제.
-- message_attachment(V28/V49/V50) 패턴 미러 — tenant_id + RLS 포함.
CREATE TABLE chat_message_attachment (
  file_id     BIGINT PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  message_id  BIGINT NOT NULL REFERENCES chat_message(id) ON DELETE CASCADE,
  attached_by BIGINT NOT NULL REFERENCES "user"(id),
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 신규 테이블이므로 백필 불필요. GUC 기본값으로 INSERT 시 자동 채움.
  tenant_id   BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
              REFERENCES tenant(id)
);
CREATE INDEX idx_chat_message_attachment_message ON chat_message_attachment(message_id);
CREATE INDEX idx_chat_message_attachment_tenant ON chat_message_attachment(tenant_id);

-- 테넌트 격리 RLS (V50 message_attachment 정책과 동형).
ALTER TABLE chat_message_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_message_attachment_tenant_isolation ON chat_message_attachment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 첨부만 있는 메시지 허용: chat_message.body 의 NOT NULL + 기존 길이 제약을 완화.
-- 기존 CHECK 가 `length(body) BETWEEN 1 AND 4000`(V16) 이라 빈 문자열('')을 거부한다.
-- 첨부-only 메시지는 body='' 로 전송되므로(프론트 trim 결과) 이 제약을 반드시 교체한다.
ALTER TABLE chat_message ALTER COLUMN body DROP NOT NULL;
ALTER TABLE chat_message DROP CONSTRAINT chat_message_body_check;
ALTER TABLE chat_message ADD CONSTRAINT chat_message_body_check
  CHECK (body IS NULL OR length(body) <= 4000);

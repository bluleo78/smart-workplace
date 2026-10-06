-- WP-234: 메인 AI 채팅(홈) 메시지 파일 첨부 정션. file_id PK 로 파일 1개 = 메시지 1개(V82 chat_message_attachment 와 같은 설계).
-- 세션 삭제 → home_message CASCADE → 연결 행 삭제. 파일 본체는 세션 삭제 시 서비스가 expires_at 을 당겨 FileCleanupService 가 치운다.
-- expand 단계 — 새 테이블만 추가하므로 구버전 앱과 공존한다. home_message.content 의 NOT NULL 은 유지(첨부만 보낸 메시지는 '' 저장).
CREATE TABLE home_message_attachment (
  file_id     BIGINT PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  message_id  BIGINT NOT NULL REFERENCES home_message(id) ON DELETE CASCADE,
  attached_by BIGINT NOT NULL REFERENCES "user"(id),
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 신규 테이블이라 백필 불필요. GUC 기본값으로 INSERT 시 자동 채움(V82 와 같은 식).
  tenant_id   BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
              REFERENCES tenant(id)
);
CREATE INDEX idx_home_message_attachment_message ON home_message_attachment(message_id);
CREATE INDEX idx_home_message_attachment_tenant ON home_message_attachment(tenant_id);

-- 테넌트 격리 RLS (V66 home_message 정책과 동형, NULLIF fail-closed).
ALTER TABLE home_message_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY home_message_attachment_tenant_isolation ON home_message_attachment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

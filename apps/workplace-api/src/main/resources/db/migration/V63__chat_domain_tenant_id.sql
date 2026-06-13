-- V63: chat 도메인(chat_thread / chat_thread_member / chat_message)에 tenant_id 컬럼 추가 + 백필 + FK.
-- RLS 활성화는 V64 에서 수행 — 이 마이그레이션은 컬럼/인덱스/FK 만.
--
-- DEFAULT 는 V47/V61 과 동일하게 백필 완료 후 추가한다:
--   Flyway 는 superuser(app)로 실행되며 GUC(app.tenant_id)가 미설정 상태이므로,
--   DEFAULT 를 먼저 붙이면 nullable->notnull 전환 시 current_setting 이 NULL 을 반환해
--   NOT NULL 위반이 발생한다. 백필 후 DEFAULT 설정 순서를 반드시 지킨다.
-- 처리 순서: chat_thread(루트) 를 완전히(NOT NULL 까지) 채운 뒤 →
--   chat_thread_member/chat_message 가 chat_thread.tenant_id 를 읽어 백필한다.
--
-- PK/UNIQUE 는 모두 유지(변경 불필요):
--   chat_thread.id(BIGSERIAL) / chat_thread.issue_id UNIQUE(이미 테넌트 스코프된 issue 기준이라 안전)
--   chat_thread_member PK(thread_id,user_id)(테넌트 스코프된 thread_id 기준 → 안전)
--   chat_message.id(BIGSERIAL).

-- ============================================================
-- 1) chat_thread (루트: issue 1:1 → issue.tenant_id 백필)
-- ============================================================
ALTER TABLE chat_thread ADD COLUMN tenant_id BIGINT;

-- issue 는 이미 테넌트 스코프됨(V47). issue_id UNIQUE 로 1:1.
UPDATE chat_thread c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE chat_thread ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE chat_thread ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE chat_thread ADD CONSTRAINT fk_chat_thread_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_chat_thread_tenant ON chat_thread(tenant_id);

-- ============================================================
-- 2) chat_thread_member (thread_id → chat_thread)
-- ============================================================
ALTER TABLE chat_thread_member ADD COLUMN tenant_id BIGINT;

UPDATE chat_thread_member m SET tenant_id = t.tenant_id FROM chat_thread t WHERE m.thread_id = t.id;

ALTER TABLE chat_thread_member ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE chat_thread_member ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE chat_thread_member ADD CONSTRAINT fk_chat_thread_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_chat_thread_member_tenant ON chat_thread_member(tenant_id);

-- ============================================================
-- 3) chat_message (thread_id → chat_thread)
-- ============================================================
ALTER TABLE chat_message ADD COLUMN tenant_id BIGINT;

UPDATE chat_message m SET tenant_id = t.tenant_id FROM chat_thread t WHERE m.thread_id = t.id;

ALTER TABLE chat_message ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE chat_message ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE chat_message ADD CONSTRAINT fk_chat_message_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_chat_message_tenant ON chat_message(tenant_id);

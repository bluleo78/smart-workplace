-- V58: calendar·mail·contacts 도메인 11개 테이블에 tenant_id 컬럼 추가 + 백필 + FK + 인덱스.
-- RLS 활성화는 V59 에서 수행 — 이 마이그레이션은 컬럼/인덱스/FK + 유니크 재정의만.
-- 대상 테이블(11):
--   calendar: calendar_event, event_reminder, calendar_event_exception
--   mail:     email_account, email_folder, email_message, email_attachment
--   contacts: contact_entry, contact_favorite, user_group, user_group_member
--
-- 백필 전략: 레거시 데이터는 단일 테넌트라 전부 tenant#1 고정(상수). 부모 join 백필이 아님
--   — 11개 모두 레거시 전체가 tenant#1 이므로 상수 백필이 정확하다(V52 file/drive 와 동일 철학).
--
-- DEFAULT 순서 주의(V47 과 동일 함정 회피):
--   Flyway 는 소유자 롤(app)로 실행되며 GUC(app.tenant_id) 미설정이다. DEFAULT 를 먼저 붙이면
--   nullable→notnull 전환 시 current_setting 이 NULL 을 반환해 NOT NULL 위반이 발생한다.
--   따라서 반드시 [컬럼추가 → 백필 → DEFAULT → NOT NULL] 순서를 지킨다.
-- DEFAULT 식은 NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   — 런타임 INSERT 시 트랜잭션-로컬 GUC 값을 자동으로 채운다(애플리케이션은 tenant_id 를 명시하지 않음).

-- ============================================================
-- calendar
-- ============================================================

-- 1) calendar_event (상수: tenant_id = 1)
ALTER TABLE calendar_event ADD COLUMN tenant_id BIGINT;

UPDATE calendar_event SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE calendar_event ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE calendar_event ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE calendar_event ADD CONSTRAINT fk_calendar_event_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_calendar_event_tenant ON calendar_event(tenant_id);

-- 2) event_reminder (상수: tenant_id = 1)
ALTER TABLE event_reminder ADD COLUMN tenant_id BIGINT;

UPDATE event_reminder SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE event_reminder ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE event_reminder ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE event_reminder ADD CONSTRAINT fk_event_reminder_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_event_reminder_tenant ON event_reminder(tenant_id);

-- 3) calendar_event_exception (상수: tenant_id = 1)
ALTER TABLE calendar_event_exception ADD COLUMN tenant_id BIGINT;

UPDATE calendar_event_exception SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE calendar_event_exception ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE calendar_event_exception ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE calendar_event_exception ADD CONSTRAINT fk_calendar_event_exception_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_calendar_event_exception_tenant ON calendar_event_exception(tenant_id);

-- ============================================================
-- mail
-- ============================================================

-- 4) email_account (상수: tenant_id = 1)
ALTER TABLE email_account ADD COLUMN tenant_id BIGINT;

UPDATE email_account SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE email_account ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE email_account ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE email_account ADD CONSTRAINT fk_email_account_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_email_account_tenant ON email_account(tenant_id);

-- 5) email_folder (상수: tenant_id = 1)
ALTER TABLE email_folder ADD COLUMN tenant_id BIGINT;

UPDATE email_folder SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE email_folder ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE email_folder ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE email_folder ADD CONSTRAINT fk_email_folder_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_email_folder_tenant ON email_folder(tenant_id);

-- 6) email_message (상수: tenant_id = 1)
ALTER TABLE email_message ADD COLUMN tenant_id BIGINT;

UPDATE email_message SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE email_message ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE email_message ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE email_message ADD CONSTRAINT fk_email_message_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_email_message_tenant ON email_message(tenant_id);

-- 7) email_attachment (상수: tenant_id = 1)
ALTER TABLE email_attachment ADD COLUMN tenant_id BIGINT;

UPDATE email_attachment SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE email_attachment ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE email_attachment ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE email_attachment ADD CONSTRAINT fk_email_attachment_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_email_attachment_tenant ON email_attachment(tenant_id);

-- ============================================================
-- contacts
-- ============================================================

-- 8) contact_entry (상수: tenant_id = 1)
ALTER TABLE contact_entry ADD COLUMN tenant_id BIGINT;

UPDATE contact_entry SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE contact_entry ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE contact_entry ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_entry ADD CONSTRAINT fk_contact_entry_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_contact_entry_tenant ON contact_entry(tenant_id);

-- 9) contact_favorite (상수: tenant_id = 1)
ALTER TABLE contact_favorite ADD COLUMN tenant_id BIGINT;

UPDATE contact_favorite SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE contact_favorite ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE contact_favorite ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_favorite ADD CONSTRAINT fk_contact_favorite_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_contact_favorite_tenant ON contact_favorite(tenant_id);

-- 10) user_group (상수: tenant_id = 1)
ALTER TABLE user_group ADD COLUMN tenant_id BIGINT;

UPDATE user_group SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE user_group ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE user_group ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_group ADD CONSTRAINT fk_user_group_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_user_group_tenant ON user_group(tenant_id);

-- 11) user_group_member (상수: tenant_id = 1)
ALTER TABLE user_group_member ADD COLUMN tenant_id BIGINT;

UPDATE user_group_member SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE user_group_member ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE user_group_member ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_group_member ADD CONSTRAINT fk_user_group_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_user_group_member_tenant ON user_group_member(tenant_id);

-- ============================================================
-- 유니크 인덱스 재정의: 전역키 → 테넌트 포함 (컬럼 추가 완료 후 수행)
-- ============================================================
-- 유니크 인덱스는 RLS 를 우회해 전역(모든 테넌트 행)에 적용되므로, user_id/code 같은 전역 기반 키는
-- tenant_id 를 포함하지 않으면 서로 다른 테넌트의 동일 키가 충돌한다 → tenant_id 를 인덱스에 포함한다.

-- 이메일 계정 주소 유니크: 같은 유저가 테넌트별로 같은 주소 계정을 가질 수 있어야 함.
DROP INDEX uq_email_account_user_addr;
CREATE UNIQUE INDEX uq_email_account_user_addr
  ON email_account (tenant_id, user_id, email_address) WHERE disabled_at IS NULL;

-- 공유 그룹 code 유니크: 테넌트별 네임스페이스(동기화 upsert 키).
DROP INDEX idx_user_group_code_shared;
CREATE UNIQUE INDEX idx_user_group_code_shared
  ON user_group (tenant_id, code) WHERE code IS NOT NULL AND visibility = 'SHARED';

-- ============================================================
-- 수정 불필요(전이 안전) — email_* UNIQUE 전수 확인 결과
-- ============================================================
-- email_folder  UNIQUE(account_id, name)               : account_id → email_account(테넌트 스코프) FK → 전이 안전.
-- email_message UNIQUE(account_id, folder_id, imap_uid) : account_id/folder_id 모두 테넌트 스코프 FK → 전이 안전.
-- email_attachment                                       : UNIQUE 없음(message_id FK 인덱스만) → 무관.
-- event_reminder.event_id UNIQUE                         : event_id → calendar_event(테넌트 스코프) FK → 전이 안전.
-- calendar_event_exception_uq(event_id, occurrence_date) : event_id → calendar_event(테넌트 스코프) FK → 전이 안전.
-- contact_favorite PK(owner_id, target_type, target_id)  : target_id 가 테넌트 스코프 엔티티 id → 충돌 불가(전이 안전).
-- user_group_member PK(group_id, target_type, target_id) : group_id → user_group(테넌트 스코프) FK → 전이 안전.

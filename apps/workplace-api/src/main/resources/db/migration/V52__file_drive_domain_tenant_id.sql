-- V52: file·drive 도메인 5개 테이블에 tenant_id 컬럼 추가 + 백필 + FK + 인덱스.
-- RLS 활성화는 V53 에서 수행 — 이 마이그레이션은 컬럼/인덱스/FK + 유니크 재정의만.
-- 대상 테이블(5): file, drive_space, drive_space_member, drive_folder, drive_file.
--
-- 백필 전략: 레거시 데이터는 단일 테넌트라 전부 tenant#1 고정(상수). 부모 join 백필이 아님
--   — file 은 issue 도메인처럼 단일 부모로 환원되지 않고 여러 컨텍스트(chat/drive/avatar)에서
--   공유되며, 레거시 전체가 tenant#1 이므로 상수 백필이 정확하다.
--
-- DEFAULT 순서 주의(V47 과 동일 함정 회피):
--   Flyway 는 소유자 롤(app)로 실행되며 GUC(app.tenant_id) 미설정이다. DEFAULT 를 먼저 붙이면
--   nullable→notnull 전환 시 current_setting 이 NULL 을 반환해 NOT NULL 위반이 발생한다.
--   따라서 반드시 [컬럼추가 → 백필 → DEFAULT → NOT NULL] 순서를 지킨다.
-- DEFAULT 식은 NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   — 런타임 INSERT 시 트랜잭션-로컬 GUC 값을 자동으로 채운다(애플리케이션은 tenant_id 를 명시하지 않음).

-- ============================================================
-- 1) file (상수: tenant_id = 1)
-- ============================================================
ALTER TABLE file ADD COLUMN tenant_id BIGINT;

UPDATE file SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE file ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE file ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE file ADD CONSTRAINT fk_file_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_file_tenant ON file(tenant_id);

-- ============================================================
-- 2) drive_space (상수: tenant_id = 1)
-- ============================================================
ALTER TABLE drive_space ADD COLUMN tenant_id BIGINT;

UPDATE drive_space SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE drive_space ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE drive_space ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE drive_space ADD CONSTRAINT fk_drive_space_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_drive_space_tenant ON drive_space(tenant_id);

-- ============================================================
-- 3) drive_space_member (상수: tenant_id = 1)
-- ============================================================
ALTER TABLE drive_space_member ADD COLUMN tenant_id BIGINT;

UPDATE drive_space_member SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE drive_space_member ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE drive_space_member ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE drive_space_member ADD CONSTRAINT fk_drive_space_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_drive_space_member_tenant ON drive_space_member(tenant_id);

-- ============================================================
-- 4) drive_folder (상수: tenant_id = 1)
-- ============================================================
ALTER TABLE drive_folder ADD COLUMN tenant_id BIGINT;

UPDATE drive_folder SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE drive_folder ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE drive_folder ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE drive_folder ADD CONSTRAINT fk_drive_folder_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_drive_folder_tenant ON drive_folder(tenant_id);

-- ============================================================
-- 5) drive_file (상수: tenant_id = 1)
-- ============================================================
ALTER TABLE drive_file ADD COLUMN tenant_id BIGINT;

UPDATE drive_file SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE drive_file ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE drive_file ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE drive_file ADD CONSTRAINT fk_drive_file_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_drive_file_tenant ON drive_file(tenant_id);

-- ============================================================
-- 유니크 인덱스 수정: drive_space 개인공간
-- ============================================================
-- 개인 드라이브 공간은 '테넌트별로 유저당 1개'여야 한다.
-- 유니크 인덱스는 RLS 를 우회해 전역(모든 테넌트 행)에 적용되므로 tenant_id 를 포함하지 않으면
-- 서로 다른 테넌트의 동일 owner_id 가 충돌한다 → tenant_id 를 인덱스에 포함해야 한다.
DROP INDEX uq_drive_space_personal_owner;
CREATE UNIQUE INDEX uq_drive_space_personal_owner
  ON drive_space (tenant_id, owner_id) WHERE type = 'PERSONAL';

-- 참고: uq_drive_folder_name (space_id, COALESCE(parent_id,0), name) WHERE trashed_at IS NULL 은
--   space_id 가 이미 한 테넌트에 귀속(drive_space.tenant_id)되어 전이적으로 테넌트 스코프이므로
--   tenant_id 를 추가할 필요가 없다(서로 다른 테넌트는 서로 다른 space_id 를 가짐) → 수정하지 않는다.

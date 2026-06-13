-- V61: RBAC 도메인(role / role_permission / user_role)에 tenant_id 컬럼 추가 + 백필 + FK.
-- RLS 활성화는 V62 에서 수행 — 이 마이그레이션은 컬럼/인덱스/FK/유니크 만.
-- permission 은 전역 코드 카탈로그로 유지(tenant_id 없음, RLS 없음).
--
-- 과도기 모델: 기존 시스템 역할(ADMIN/USER)과 그 권한/할당은 모두 tenant#1 로 귀속한다.
--   테넌트별 기본-역할 프로비저닝은 P5 후속(여기서 만들지 않는다).
--
-- DEFAULT 는 V47 과 동일하게 백필 완료 후 추가한다:
--   Flyway 는 superuser(app)로 실행되며 GUC(app.tenant_id)가 미설정 상태이므로,
--   DEFAULT 를 먼저 붙이면 nullable->notnull 전환 시 current_setting 이 NULL 을 반환해
--   NOT NULL 위반이 발생한다. 백필 후 DEFAULT 설정 순서를 반드시 지킨다.
-- 처리 순서: role(루트) 를 완전히 채운 뒤 → role_permission/user_role 이 role.tenant_id 를 읽어 백필.

-- ============================================================
-- 1) role (루트: 신원 테이블, 부모 없음 → tenant_id = 1 고정)
-- ============================================================
ALTER TABLE role ADD COLUMN tenant_id BIGINT;

UPDATE role SET tenant_id = 1;

ALTER TABLE role ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE role ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE role ADD CONSTRAINT fk_role_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_role_tenant ON role(tenant_id);

-- role.name 전역 UNIQUE → (tenant_id, name) 테넌트 스코프 UNIQUE 로 교체.
-- (PK/유니크 인덱스는 RLS 를 우회하므로 같은 역할 이름을 여러 테넌트에서 쓰려면 tenant_id 를 키에 포함해야 한다.)
-- role_name_key 는 `name VARCHAR(50) UNIQUE` 의 Postgres 자동 생성 제약명(V2).
ALTER TABLE role DROP CONSTRAINT role_name_key;
ALTER TABLE role ADD CONSTRAINT uq_role_tenant_name UNIQUE (tenant_id, name);

-- ============================================================
-- 2) role_permission (role_id → role)
-- ============================================================
ALTER TABLE role_permission ADD COLUMN tenant_id BIGINT;

UPDATE role_permission rp SET tenant_id = r.tenant_id FROM role r WHERE rp.role_id = r.id;

ALTER TABLE role_permission ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE role_permission ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE role_permission ADD CONSTRAINT fk_role_permission_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_role_permission_tenant ON role_permission(tenant_id);

-- ============================================================
-- 3) user_role (role_id → role)
-- ============================================================
ALTER TABLE user_role ADD COLUMN tenant_id BIGINT;

UPDATE user_role ur SET tenant_id = r.tenant_id FROM role r WHERE ur.role_id = r.id;

ALTER TABLE user_role ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE user_role ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_role ADD CONSTRAINT fk_user_role_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_user_role_tenant ON user_role(tenant_id);

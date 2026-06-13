-- V44: 멀티테넌트 기반 — 비특권 런타임 롤 app_tenant, tenant/membership 글로벌 테이블,
-- 기존 데이터 Tenant#1 백필, app_tenant 권한 부여. 도메인 테이블의 tenant_id/RLS 는 P2.
-- Flyway 는 소유자 권한 롤(app)로 실행되므로 CREATE ROLE/GRANT 가능.

-- 0) 비특권 런타임 롤 (idempotent). RLS 적용 대상(비소유·비bypass).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant LOGIN PASSWORD 'app_tenant'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_tenant;

-- 1) 테넌트 (글로벌)
CREATE TABLE tenant (
    id         BIGSERIAL    PRIMARY KEY,
    slug       VARCHAR(64)  UNIQUE,
    name       VARCHAR(255) NOT NULL,
    status     VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);
COMMENT ON TABLE tenant IS '테넌트(고객사 워크스페이스) — 글로벌';

-- 2) 사용자↔테넌트 멤버십 (글로벌 N:M, 다중 소속 허용)
CREATE TABLE membership (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    tenant_id  BIGINT      NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    status     VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP   NOT NULL DEFAULT NOW(),
    CONSTRAINT membership_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    CONSTRAINT membership_unique UNIQUE (user_id, tenant_id)
);
CREATE INDEX idx_membership_user   ON membership(user_id);
CREATE INDEX idx_membership_tenant ON membership(tenant_id);
COMMENT ON TABLE membership IS '사용자-테넌트 소속 (다중 소속 허용)';

-- 3) 플랫폼 운영자 플래그 (테넌트 멤버십과 직교)
ALTER TABLE "user" ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN "user".is_platform_admin IS '플랫폼 운영자(슈퍼어드민) 여부 — 운영자 콘솔 접근';

-- 4) 기본 테넌트 시드 + 기존 데이터 귀속
INSERT INTO tenant (id, slug, name, status)
VALUES (1, 'default', 'Default Workspace', 'ACTIVE');
SELECT setval('tenant_id_seq', 1, true);

-- 기존 모든 사용자(HUMAN/AGENT)를 Tenant#1 멤버로
INSERT INTO membership (user_id, tenant_id, status)
SELECT id, 1, 'ACTIVE' FROM "user";

-- 기존 ADMIN 역할 보유 사용자를 플랫폼 운영자로 승격
UPDATE "user" u SET is_platform_admin = TRUE
WHERE EXISTS (
  SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.name = 'ADMIN'
);

-- 5) 비특권 런타임 롤 권한 (현존 + 향후 테이블/시퀀스)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_tenant;

-- V138 (WP-48): M365 SSO 로그인 기반 스키마.
--
-- 1) tenant.sso_enabled — 워크스페이스 관리자가 켜고 끄는 "SSO 로그인 사용". 기본 꺼짐.
--    tenant 는 RLS 비대상 전역 테이블이라 로그인 전(테넌트 컨텍스트 없음) 단계에서도 읽힌다.
-- 2) user_external_identity — 전역 계정 ↔ 외부 IdP 신원(Entra tid+oid) 연결. 전역(RLS 없음).
--    (provider, issuer_tenant, subject) 유니크: 한 Microsoft 계정은 한 사용자에게만.
--    (user_id, provider) 유니크: 한 사용자는 Microsoft 계정 하나만.
-- 3) 권한 sso:manage — 기존 시스템 ADMIN 역할에 부여. 신규 테넌트는 TenantProvisioningService 가
--    ADMIN 에 전체 권한(grantAllPermissions)을 주므로 자동 포함된다.
-- app_tenant 런타임 롤 권한은 V44 의 ALTER DEFAULT PRIVILEGES 로 자동 부여된다.

ALTER TABLE tenant ADD COLUMN sso_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE user_external_identity (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider      VARCHAR(20)  NOT NULL,
  issuer_tenant VARCHAR(64)  NOT NULL,
  subject       VARCHAR(128) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_external_identity_subject UNIQUE (provider, issuer_tenant, subject),
  CONSTRAINT uq_user_external_identity_user UNIQUE (user_id, provider)
);

INSERT INTO permission (code, description, category)
VALUES ('sso:manage', 'SSO 설정 관리', 'user')
ON CONFLICT (code) DO NOTHING;

-- role/role_permission 은 RLS ENABLE(미-FORCE) — Flyway 소유자 롤은 BYPASSRLS. tenant_id 는 role 에서 가져와 명시(V132 패턴).
INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code = 'sso:manage'
WHERE r.name = 'ADMIN'
  AND r.is_system = true
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

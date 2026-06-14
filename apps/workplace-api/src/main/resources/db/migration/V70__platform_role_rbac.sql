-- 플랫폼 평면 RBAC — 운영자 콘솔 접근 권한을 is_platform_admin 불리언에서 역할 기반으로 전환.
-- 테넌트 role/user_role(tenant_id + RLS)과 분리된 전역 평면. RLS 미적용 —
-- V44 의 ALTER DEFAULT PRIVILEGES 로 app_tenant DML 자동 부여되어 런타임(signup)에서 INSERT 가능.

-- 1) 플랫폼 역할
CREATE TABLE platform_role (
    id          BIGSERIAL    PRIMARY KEY,
    name        VARCHAR(50)  UNIQUE NOT NULL,
    description VARCHAR(255),
    is_system   BOOLEAN      DEFAULT FALSE,
    created_at  TIMESTAMP    DEFAULT NOW()
);
COMMENT ON TABLE platform_role IS '플랫폼(운영자) 평면 역할 — 테넌트 role 과 분리된 전역 RBAC';

-- 2) 플랫폼 역할-권한 (전역 permission 카탈로그 재사용)
CREATE TABLE platform_role_permission (
    platform_role_id BIGINT NOT NULL REFERENCES platform_role(id) ON DELETE CASCADE,
    permission_id    BIGINT NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
    PRIMARY KEY (platform_role_id, permission_id)
);

-- 3) 사용자-플랫폼 역할 (is_platform_admin 불리언을 대체)
CREATE TABLE platform_user_role (
    user_id          BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    platform_role_id BIGINT NOT NULL REFERENCES platform_role(id) ON DELETE CASCADE,
    granted_at       TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, platform_role_id)
);
CREATE INDEX idx_platform_user_role_role ON platform_user_role(platform_role_id);

-- 4) 플랫폼 권한 카탈로그 (전역 permission 테이블에 추가; category='platform')
INSERT INTO permission (code, description, category) VALUES
    ('platform:tenant:create',  '테넌트 생성',        'platform'),
    ('platform:tenant:read',    '테넌트 조회',        'platform'),
    ('platform:tenant:suspend', '테넌트 정지/활성',   'platform'),
    ('platform:member:read',    '테넌트 멤버 조회',   'platform');

-- 5) 시스템 역할 SUPER_ADMIN — 모든 플랫폼 권한
INSERT INTO platform_role (name, description, is_system) VALUES
    ('SUPER_ADMIN', '플랫폼 슈퍼 관리자 — 모든 운영 권한', TRUE);

INSERT INTO platform_role_permission (platform_role_id, permission_id)
SELECT pr.id, p.id
FROM platform_role pr, permission p
WHERE pr.name = 'SUPER_ADMIN' AND p.category = 'platform';

-- 6) 백필 — 기존 is_platform_admin=TRUE 사용자를 SUPER_ADMIN 으로.
--    is_platform_admin 컬럼은 후속 V71 에서 제거(코드가 더 이상 읽지 않게 된 뒤).
INSERT INTO platform_user_role (user_id, platform_role_id)
SELECT u.id, pr.id
FROM "user" u, platform_role pr
WHERE u.is_platform_admin = TRUE AND pr.name = 'SUPER_ADMIN';

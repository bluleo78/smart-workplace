-- V139 (WP-104): 플랫폼 콘솔로 만든 테넌트의 USER 역할에 빠진 업무 권한 보충.
--
-- 배경: TenantProvisioningService 가 신규 테넌트 USER 에 self 권한(member:read, user:read:self,
-- user:write:self)만 시드했다. 그래서 tenant#1 이외 테넌트의 일반 구성원은 연락처·프로젝트·이슈·캘린더
-- API 가 전부 403 이었다(연락처 화면 "목록을 불러오지 못했습니다"). 시드 코드는 tenant#1 USER 와 같은
-- 집합으로 고쳤고, 이 마이그레이션은 이미 만들어진 테넌트의 USER 시스템 역할을 같은 집합으로 채운다.
--
-- 추가만 하고 제거는 하지 않는다(이미 있는 권한은 NOT EXISTS 로 건너뜀) — 재실행해도 결과가 같다.
-- 계정 관리 권한(user:read/user:write/role:assign)은 ADMIN 전용이라 대상이 아니다.
--
-- RLS 주의: role/role_permission 은 RLS ENABLE(미-FORCE) → 소유자 app(Flyway)은 BYPASSRLS.
-- role_permission.tenant_id 는 NOT NULL 이고 DEFAULT 가 GUC 기반(Flyway 에선 NULL)이라 role 에서 가져와 명시한다.
INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code IN (
    'project:read',
    'project:write',
    'project:manage',
    'issue:write',
    'label:manage',
    'savedview:manage',
    'cycle:manage',
    'milestone:manage',
    'contact:read',
    'contact:write',
    'calendar:read',
    'calendar:write',
    'member:read',
    'user:read:self',
    'user:write:self'
  )
WHERE r.name = 'USER'
  AND r.is_system = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

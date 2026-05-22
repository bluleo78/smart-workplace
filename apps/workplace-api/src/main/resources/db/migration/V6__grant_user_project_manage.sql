-- V6: USER 역할에 project:manage 권한 부여
-- - 일반 사용자가 본인이 OWNER 인 프로젝트의 멤버 관리/삭제를 수행할 수 있도록 함
-- - 실제 OWNER 여부는 service 의 ProjectAccessGuard.assertWithRole(... "OWNER") 에서 추가 검증

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'USER'
  AND p.code = 'project:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

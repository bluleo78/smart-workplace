-- USER 역할에 contact:write 부여 — 모든 구성원이 외부 연락처를 생성·관리(개인/공유).
-- (V31 은 ADMIN 에만 부여했고 USER 에는 contact:read 만 부여했다.)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.name = 'USER' AND p.code = 'contact:write'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

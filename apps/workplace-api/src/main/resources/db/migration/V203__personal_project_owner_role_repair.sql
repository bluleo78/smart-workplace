-- V203 (WP-856): 개인 프로젝트의 소유자를 주인(project.owner_id) 하나로 되돌린다.
-- 역할 변경 API 에 개인 프로젝트 규칙이 없어 AGENT 가 OWNER 로 올라가고 주인이 MEMBER 로 내려간 행이 남았을 수 있다.
-- 새 변경은 ProjectService.checkPersonalRoleChange 가 막는다 — 이 마이그레이션은 그 이전에 남은 행만 고친다.
-- 데이터만 고치므로 구·신 버전 공존(롤링 배포)에 영향이 없다. 소유자 app 은 BYPASSRLS 라 전 테넌트에 적용된다.
UPDATE project_member pm
SET role = 'MEMBER'
FROM project p
WHERE p.id = pm.project_id
  AND p.type = 'PERSONAL'
  AND pm.user_id <> p.owner_id
  AND pm.role = 'OWNER';

UPDATE project_member pm
SET role = 'OWNER'
FROM project p
WHERE p.id = pm.project_id
  AND p.type = 'PERSONAL'
  AND pm.user_id = p.owner_id
  AND pm.role <> 'OWNER';

-- V75 (#278): AI 에이전트용 'AGENT' 시스템 역할 — 개인 비서 기본 역할.
-- 배경: AGENT 유저는 역할이 0개라 권한이 전무 → 이슈 컨텍스트 챗에서 project:read/issue:write 게이트 403.
-- 모든 테넌트에 AGENT 역할 + 12개 권한(USER 에서 project:manage 제외)을 시드하고,
-- 기존 '개인 비서'(user.personal_assistant_agent_id 로 링크된 AGENT)를 자기 테넌트의 AGENT 역할에 백필한다.
-- ※ 업무별 에이전트(관리자 생성)는 자동 부여 대상 아님 — 관리자가 사용자 상세 UI 에서 개별 설정한다.
--
-- RLS 주의: role/role_permission/user_role 은 RLS ENABLE(미-FORCE) → 소유자 app(Flyway)은 BYPASSRLS.
-- 단 tenant_id 는 NOT NULL 이고 DEFAULT 가 GUC 기반(Flyway 에선 NULL)이라 반드시 명시한다.

-- 1) 각 테넌트에 AGENT 역할 (없으면)
INSERT INTO role (name, description, is_system, tenant_id)
SELECT 'AGENT', 'AI 에이전트(개인 비서)', TRUE, t.id
FROM tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM role r WHERE r.name = 'AGENT' AND r.tenant_id = t.id
);

-- 2) AGENT 역할에 12개 권한 부여 (permission 은 전역 카탈로그). 멱등 — 이미 있으면 건너뜀.
INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code IN (
  'project:read', 'project:write', 'issue:write',
  'label:manage', 'savedview:manage', 'cycle:manage',
  'contact:read', 'contact:write',
  'calendar:read', 'calendar:write',
  'user:read:self', 'user:write:self'
)
WHERE r.name = 'AGENT'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 3) 기존 개인 비서 백필 — personal_assistant_agent_id 로 링크된 AGENT 유저를 자기 테넌트의 AGENT 역할에 할당.
INSERT INTO user_role (user_id, role_id, tenant_id)
SELECT pa.assistant_id, r.id, m.tenant_id
FROM (
  SELECT personal_assistant_agent_id AS assistant_id
  FROM "user"
  WHERE personal_assistant_agent_id IS NOT NULL
) pa
JOIN membership m ON m.user_id = pa.assistant_id
JOIN role r ON r.name = 'AGENT' AND r.tenant_id = m.tenant_id
WHERE NOT EXISTS (
  SELECT 1 FROM user_role ur WHERE ur.user_id = pa.assistant_id AND ur.role_id = r.id
);

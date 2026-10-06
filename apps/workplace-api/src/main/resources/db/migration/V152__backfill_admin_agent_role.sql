-- V152 (WP-252): 관리자가 만든 업무별 에이전트에 기본 AGENT 역할 백필.
-- 배경: V75 는 "업무별 에이전트(관리자 생성)는 관리자가 개별 설정" 정책이라 개인 비서만 AGENT 역할에 백필했다.
-- 그 결과 관리 화면에서 만든 에이전트는 역할 0개 → project:read/issue:write 등이 없어 담당 이슈 조회·처리가 403.
-- 정책 변경: 에이전트는 생성 시 AGENT 역할을 기본 부여한다(UserService.createAgent). 기존 계정도 동일하게 맞춘다.
--
-- 대상: kind='AGENT' 이면서 user_role 이 **하나도 없는** 계정만. 관리자가 이미 역할을 지정한 에이전트는 건드리지 않는다.
-- RLS 주의: user_role 은 RLS ENABLE(미-FORCE) → 소유자 app(Flyway)은 BYPASSRLS. tenant_id 는 NOT NULL 이고
-- DEFAULT 가 GUC 기반(Flyway 에선 NULL)이라 멤버십의 테넌트로 명시한다. NOT EXISTS 로 멱등.
INSERT INTO user_role (user_id, role_id, tenant_id)
SELECT u.id, r.id, m.tenant_id
FROM "user" u
JOIN membership m ON m.user_id = u.id
JOIN role r ON r.name = 'AGENT' AND r.is_system = TRUE AND r.tenant_id = m.tenant_id
WHERE u.kind = 'AGENT'
  AND NOT EXISTS (SELECT 1 FROM user_role ur WHERE ur.user_id = u.id);

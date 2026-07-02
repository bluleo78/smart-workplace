-- V118__epic_issue_type.sql
-- EPIC 시스템 유형 추가 — 여러 하위 이슈(TASK/BUG/STORY/CHORE)를 담는 최상위 컨테이너.
-- TEAM/OPEN(공유) 프로젝트에만 소급 시드, PERSONAL 프로젝트는 제외.
-- tenant_id 는 GUC(app.tenant_id) 기반 DEFAULT 라 Flyway(GUC 미설정) 실행 시 NULL 이 되므로 명시적으로 설정.

INSERT INTO issue_type_def (project_id, tenant_id, name, color_token, icon, is_system, position)
SELECT id, tenant_id, 'EPIC', 'INDIGO', 'Flag', true, 5
FROM project
WHERE type IN ('TEAM', 'OPEN');

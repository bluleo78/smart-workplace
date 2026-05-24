-- V11__subtasks.sql
-- Jira 스타일 SUBTASK 시스템 유형 시드 + issue.parent_issue_id 1단계 트리 컬럼.

INSERT INTO issue_type_def (project_id, name, color_token, icon, is_system, position)
SELECT id, 'SUBTASK', 'TEAL', 'CornerDownRight', true, 4 FROM project;

ALTER TABLE issue ADD COLUMN parent_issue_id BIGINT NULL REFERENCES issue(id) ON DELETE CASCADE;
CREATE INDEX idx_issue_parent ON issue(parent_issue_id) WHERE parent_issue_id IS NOT NULL;

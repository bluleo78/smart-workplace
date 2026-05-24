-- V10__issue_type.sql
-- 이슈 유형 정의 (프로젝트별) + 모든 이슈 type_id NOT NULL.

CREATE TABLE issue_type_def (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name            VARCHAR(40) NOT NULL,
  color_token     VARCHAR(16) NOT NULL,
  icon            VARCHAR(32) NOT NULL,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  position        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_issue_type_def_project ON issue_type_def(project_id);

ALTER TABLE issue ADD COLUMN type_id BIGINT REFERENCES issue_type_def(id) ON DELETE RESTRICT;

INSERT INTO issue_type_def (project_id, name, color_token, icon, is_system, position)
SELECT id, 'TASK',  'BLUE',   'Circle',   true, 0 FROM project
UNION ALL SELECT id, 'BUG',   'RED',    'Bug',      true, 1 FROM project
UNION ALL SELECT id, 'STORY', 'PURPLE', 'BookOpen', true, 2 FROM project
UNION ALL SELECT id, 'CHORE', 'GRAY',   'Wrench',   true, 3 FROM project;

UPDATE issue SET type_id = td.id
FROM issue_type_def td
WHERE td.project_id = issue.project_id AND td.name = 'TASK';

ALTER TABLE issue ALTER COLUMN type_id SET NOT NULL;
CREATE INDEX idx_issue_type ON issue(type_id);

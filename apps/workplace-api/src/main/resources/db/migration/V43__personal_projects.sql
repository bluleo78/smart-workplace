-- 개인 프로젝트 도입: project 성격 구분 + 기본 프로젝트 표식
ALTER TABLE project ADD COLUMN type VARCHAR(16) NOT NULL DEFAULT 'TEAM';
ALTER TABLE project ADD CONSTRAINT project_type_check
  CHECK (type IN ('TEAM', 'PERSONAL'));

ALTER TABLE project ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- 소유자별 기본 개인 프로젝트는 1개만 (중복 프로비저닝 방지)
CREATE UNIQUE INDEX uq_project_default_personal
  ON project (owner_id)
  WHERE is_default = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_project_type ON project (type);

-- V13__custom_fields.sql
-- Phase 4c — 프로젝트별 custom field 정의 + 이슈별 JSONB 값.
-- options 는 SELECT / MULTI_SELECT 만 사용. position 은 정렬용.
CREATE TABLE issue_field_def (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  type        VARCHAR(16) NOT NULL,
  options     JSONB,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_field_def_project ON issue_field_def(project_id);

CREATE TABLE issue_field_value (
  issue_id      BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  field_def_id  BIGINT NOT NULL REFERENCES issue_field_def(id) ON DELETE CASCADE,
  value         JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, field_def_id)
);
CREATE INDEX idx_field_value_def ON issue_field_value(field_def_id);

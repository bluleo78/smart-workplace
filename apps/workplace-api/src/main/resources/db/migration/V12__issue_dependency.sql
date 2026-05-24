-- V12__issue_dependency.sql
-- 이슈 간 단방향 의존성 — (issue_id, blocks_issue_id) row 는 "issue_id 가 blocks_issue_id 를 차단".
-- CHECK 로 자기참조를 막고, 양 FK 모두 ON DELETE CASCADE 로 부모 이슈 soft/hard delete 시 정리.
CREATE TABLE issue_dependency (
  issue_id          BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  blocks_issue_id   BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  created_by        BIGINT NOT NULL REFERENCES "user"(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, blocks_issue_id),
  CHECK (issue_id <> blocks_issue_id)
);
CREATE INDEX idx_issue_dep_blocks ON issue_dependency(blocks_issue_id);

-- V9__multi_assignee.sql
-- 이슈 담당자 단일 → 다중 전환 (단일컷). 운영 사용자 없음 가정.

-- 1) 매핑 테이블
CREATE TABLE issue_assignee (
  issue_id    BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  assigned_by BIGINT NOT NULL REFERENCES "user"(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX idx_issue_assignee_user ON issue_assignee(user_id);

-- 2) 기존 단일 assignee 복사 (assigned_by 는 reporter 로 대체)
INSERT INTO issue_assignee (issue_id, user_id, assigned_by, created_at)
SELECT id, assignee_id, reporter_id, created_at
FROM issue
WHERE assignee_id IS NOT NULL;

-- 3) 컬럼 제거
ALTER TABLE issue DROP COLUMN assignee_id;

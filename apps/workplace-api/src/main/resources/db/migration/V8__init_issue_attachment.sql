-- V8__init_issue_attachment.sql
-- 이슈 ↔ 파일 1:N 매핑. file 모듈의 file 테이블을 공유한다.
-- file_id PK: 파일은 한 이슈에만 부착됨. 매핑 삭제 시 file row 도 함께 정리(서비스 레벨).
CREATE TABLE issue_attachment (
  file_id      BIGINT PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  issue_id     BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  attached_by  BIGINT NOT NULL REFERENCES "user"(id),
  attached_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_issue_attachment_issue ON issue_attachment(issue_id);

COMMENT ON TABLE issue_attachment IS '이슈-파일 매핑(1:N). file 테이블 공유.';

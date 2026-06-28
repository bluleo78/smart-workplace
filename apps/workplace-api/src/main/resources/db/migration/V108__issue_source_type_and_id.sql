-- #520 메일→이슈 승격: 이슈의 출처(cross-app source) 백레퍼런스.
-- source_type: 'MAIL' (향후 'CHAT' 등 확장). source_id: 출처 엔티티 id(메일 message id).
-- 둘 다 nullable — 일반 이슈는 null. (issue, source_id) 조회용 인덱스.
ALTER TABLE issue ADD COLUMN source_type TEXT;
ALTER TABLE issue ADD COLUMN source_id   BIGINT;

CREATE INDEX idx_issue_source ON issue (source_type, source_id) WHERE source_type IS NOT NULL;

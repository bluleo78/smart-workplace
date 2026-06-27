-- 슬라이스③ contract: 첨부 메타가 content_attachment 로 이전됨 → email_attachment 에서 제거.
-- IF EXISTS: dev/test DB 에서 수동 psql 선적용 가능성 대비(prod 무위험).
ALTER TABLE email_attachment DROP COLUMN IF EXISTS filename;
ALTER TABLE email_attachment DROP COLUMN IF EXISTS content_type;
ALTER TABLE email_attachment DROP COLUMN IF EXISTS size_bytes;
ALTER TABLE email_attachment DROP COLUMN IF EXISTS content_id;

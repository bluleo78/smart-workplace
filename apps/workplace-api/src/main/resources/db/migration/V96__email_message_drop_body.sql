-- 본문·제목 email_content 일원화 완료, envelope 중복 제거.
-- body_text/body_html/snippet/subject 는 email_content 에서만 읽히며 email_message 에서 제거한다.
-- body_fetched_at 도 idempotency 가 email_content.body_fetched_at 으로 이전됐으므로 함께 제거한다.
ALTER TABLE email_message DROP COLUMN body_text;
ALTER TABLE email_message DROP COLUMN body_html;
ALTER TABLE email_message DROP COLUMN snippet;
ALTER TABLE email_message DROP COLUMN subject;
ALTER TABLE email_message DROP COLUMN body_fetched_at;

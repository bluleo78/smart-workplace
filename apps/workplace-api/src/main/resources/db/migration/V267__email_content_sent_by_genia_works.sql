-- WP-1364: 받은 메일의 X-Mailer 가 「Gen:iA Works」로 시작하면(우리 앱이 보낸 메일) 표시한다.
-- 원본(content) 속성이라 공유 content 에 두고, 본문 적재 때 헤더로 한 번 판정해 false→true 로만 바꾼다.
ALTER TABLE email_content ADD COLUMN IF NOT EXISTS sent_by_genia_works boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN email_content.sent_by_genia_works IS 'WP-1364: X-Mailer 가 Gen:iA Works 로 시작하는 메일(우리 앱 발송) 여부';

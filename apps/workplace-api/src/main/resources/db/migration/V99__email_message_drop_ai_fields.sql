-- 슬라이스②(contract): AI 요약·분류는 email_content(공유)로 이전 완료 → envelope 중복 컬럼 제거.
-- ai_needs_reply·needs_reply_done_at 은 사람별이라 envelope 잔류(#485 통일 술어).
ALTER TABLE email_message
    DROP COLUMN IF EXISTS ai_summary,
    DROP COLUMN IF EXISTS ai_category,
    DROP COLUMN IF EXISTS ai_summarized_at;

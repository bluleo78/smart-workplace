-- 슬라이스②: 공통 비서 AI 결과(요약·분류)를 envelope → content(공유)로 이전한다.
-- 같은 메일을 N명이 받아도 요약/분류는 메일당 1벌. ai_needs_reply 는 사람별이라 envelope 잔류.
ALTER TABLE email_content
    ADD COLUMN ai_summary      TEXT,
    ADD COLUMN ai_category     VARCHAR(32),
    ADD COLUMN ai_summarized_at TIMESTAMPTZ;

-- 백필: 한 content_id 를 여러 envelope(CC/BCC 수신자)가 공유하므로 content별 canonical 1개만 이전한다.
-- canonical = ai_summarized_at 최신(NULLS LAST), 동률이면 id 최신.
-- 요약: 비어있지 않은 값만 후보(blank 캐싱 금지, #480 의도 보존).
-- (마이그 컨텍스트는 RLS 우회 — V93 선례. GUC 설정 불필요.)
UPDATE email_content c
SET ai_summary = s.ai_summary,
    ai_summarized_at = s.ai_summarized_at
FROM (
    SELECT DISTINCT ON (content_id)
           content_id, ai_summary, ai_summarized_at
    FROM email_message
    WHERE content_id IS NOT NULL
      AND ai_summary IS NOT NULL AND ai_summary <> ''
    ORDER BY content_id, ai_summarized_at DESC NULLS LAST, id DESC
) s
WHERE c.id = s.content_id;

-- 분류: 비어있지 않은 category 만, content별 canonical(최신).
UPDATE email_content c
SET ai_category = s.ai_category
FROM (
    SELECT DISTINCT ON (content_id)
           content_id, ai_category
    FROM email_message
    WHERE content_id IS NOT NULL
      AND ai_category IS NOT NULL
    ORDER BY content_id, ai_summarized_at DESC NULLS LAST, id DESC
) s
WHERE c.id = s.content_id;

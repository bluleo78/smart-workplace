-- WP-1347: 분류 일괄(MailCategoryBackfillService)의 재시도 상태.
--   예전에는 단건 실패·빈 결과를 ai_categorized_at 으로 영구 제외했다 — 제공자 장애(한도·인증 등) 동안 굳은 메일이 장애가 끝나도
--   다시 분류되지 않았다. 이제 실패·빈 결과는 시도 횟수를 세고 1h·6h·24h 뒤 다시 고르며, 4번째 실패에서만 ai_categorized_at 을 남긴다.
--   ai_category_attempts 는 WP-1346 도 같은 정의로 더하므로 IF NOT EXISTS 로 둔다(어느 쪽이 먼저 머지돼도 충돌하지 않게).

ALTER TABLE email_content ADD COLUMN IF NOT EXISTS ai_category_attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE email_content ADD COLUMN ai_category_next_attempt_at timestamptz NULL;

COMMENT ON COLUMN email_content.ai_category_attempts IS
  '분류 일괄이 이 content 분류에 실패(단건 호출 실패·빈 결과)한 횟수. ai_categorized_at 을 NULL 로 되돌리면 0 으로 함께 되돌린다(WP-1347)';
COMMENT ON COLUMN email_content.ai_category_next_attempt_at IS
  '분류 일괄이 이 content 를 다시 고를 수 있는 가장 이른 시각(실패 뒤 1h·6h·24h). NULL 이면 바로 고를 수 있다(WP-1347)';

-- WP-1347: 최근 14일 안에 장애·빈 결과로 굳은 메일을 다시 분류 대상으로 되돌린다(시도 횟수 0)
UPDATE email_content SET ai_categorized_at = NULL, ai_category_attempts = 0
 WHERE ai_category IS NULL AND ai_categorized_at IS NOT NULL
   AND ai_categorized_at >= now() - interval '14 days';

-- WP-185: 받은편지함 전체 메일 카테고리 일괄 분류.
--
-- ai_categorized_at — 분류 전용 일괄 경로가 이 content 의 분류를 "시도한" 시각.
--   ③ 원본 분석의 시도 시각(ai_summarized_at)과 분리한다: 분류만 돌렸는데 요약 시도로 표시되면 이후 요약이 만들어지지 않기 때문.
--   응답을 받았는데 분류가 비면 이 값만 남아 다시 고르지 않는다(영구 미분류 — 업무 보기에 남음). 호출 실패는 기록하지 않는다.
ALTER TABLE email_content
    ADD COLUMN ai_categorized_at TIMESTAMPTZ NULL;

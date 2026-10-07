-- WP-301 후속: 노트 요약을 문단형(3~5문장)에서 메일과 같은 `• ` 목록형으로 바꾼다.
-- 이미 저장된 문단형 요약을 비워, 다음에 노트를 열 때 MISSING 으로 판정돼 목록형으로 1회 새로 요약되게 한다.
-- version/updated_at 은 건드리지 않는다(요약 갱신과 같은 원칙 — 편집기 낙관적 동시성 보호).
UPDATE wiki_page
SET ai_summary = NULL,
    ai_summary_version = NULL,
    ai_summarized_at = NULL
WHERE ai_summary IS NOT NULL;

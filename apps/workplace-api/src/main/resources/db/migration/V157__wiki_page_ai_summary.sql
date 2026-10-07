-- WP-301 노트 상단 AI 요약 저장본. 1페이지 1요약.
-- ai_summary_version: 요약 당시 wiki_page.version — 현재 version 보다 작으면 "요약 이후 노트가 바뀜"(STALE).
-- 요약 갱신은 version/updated_at 을 건드리지 않는다(편집기 낙관적 동시성 보호).
ALTER TABLE wiki_page ADD COLUMN ai_summary text;
ALTER TABLE wiki_page ADD COLUMN ai_summary_version int;
ALTER TABLE wiki_page ADD COLUMN ai_summarized_at timestamptz;

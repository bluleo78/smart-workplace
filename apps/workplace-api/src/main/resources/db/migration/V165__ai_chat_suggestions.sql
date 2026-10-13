-- WP-139: AI 대화 추천·후속 질문.
-- 모두 nullable 추가만 한다 — 롤링 배포 중 구 파드의 select/insert 가 그대로 동작(expand only).
-- home_message.followups: 답 뒤 후속 질문(JSON 문자열 배열). 다음 턴 맥락·요약은 content 만 읽으므로 섞이지 않는다.
ALTER TABLE home_message ADD COLUMN followups JSONB;
-- assistant_config.suggestion_model: 추천·후속 질문 전용 모델. NULL = 자동(API 가 제공자별로 해석).
ALTER TABLE assistant_config ADD COLUMN suggestion_model VARCHAR(64);
-- "user".ai_suggestions_enabled: 사용자별 추천 질문 켜기/끄기. NULL = 켜짐(기본).
ALTER TABLE "user" ADD COLUMN ai_suggestions_enabled BOOLEAN;

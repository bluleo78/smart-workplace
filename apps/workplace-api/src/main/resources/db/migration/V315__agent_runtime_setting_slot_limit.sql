-- WP-1754: AI 마다 동시 진행 이슈 상한. NULL 이면 템플릿 기본값(없으면 5)을 따른다.
-- expand 전용(NULL 허용 열 추가) — 구 코드는 이 열을 몰라도 그대로 동작한다.
ALTER TABLE agent_runtime_setting
  ADD COLUMN slot_limit SMALLINT NULL CHECK (slot_limit IN (1, 2, 3, 5));

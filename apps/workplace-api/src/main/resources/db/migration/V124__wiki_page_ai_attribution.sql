-- V124: wiki_page 에 AI 생성 attribution(페이지 단위 지속 신호) 컬럼 추가.
-- 목적(#736): 문단 단위 추적은 편집 시 오프셋이 깨져 버리고, 페이지 단위로만
--       "이 페이지에 AI 생성물이 포함됨"을 기록한다. 기록 시점은 AI 스트림 완료 한 곳으로 고정
--       (PUT 자동저장 경로에서는 기록하지 않음 — WikiAiService 참고).
-- nullable: AI 를 한 번도 안 쓴 페이지는 NULL(배지 미노출). 데이터 백필 불필요.
-- 인덱스 불필요: 항상 id(PK) 로 조회하거나 기존 쿼리에 컬럼만 추가되는 형태.
ALTER TABLE wiki_page ADD COLUMN ai_last_used_at timestamptz;
ALTER TABLE wiki_page ADD COLUMN ai_last_action varchar(32);

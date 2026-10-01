-- WP-158: home_message 에 AI 응답의 표시 블록 순서(텍스트·도구 그룹·위젯)를 저장하는 JSONB 컬럼.
-- ASSISTANT 메시지에만 채워지며, [{kind:'text',textStart} | {kind:'tools',stepStart} | {kind:'widget',widget}] 형태.
-- textStart 는 content 문자 오프셋, stepStart 는 tool_calls 인덱스. 라이브 스트리밍과 같은 순서로 복원하는 데 쓴다.
-- nullable — 이전 메시지·순서를 재현할 수 없는 응답은 NULL(웹은 기존 폴백 렌더: 도구 상단 → 본문 → 위젯).
ALTER TABLE home_message ADD COLUMN content_blocks JSONB;

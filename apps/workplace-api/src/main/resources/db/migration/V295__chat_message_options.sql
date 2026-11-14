-- WP-1569: 이슈 챗 AI 질문 글의 답 선택지(빠른 답변 칩).
-- report_agent_work 가 INPUT_REQUIRED + message 와 함께 보낸 options(2~4개 문자열 배열), 또는 options 없이 온 질문에서
-- 서버가 커밋 뒤 ai-agent 로 뽑아 채운 선택지를 담는다. 선택지가 없으면 NULL(칩 없음).
-- 롤링 배포 호환(expand): NULL 허용 컬럼 추가만 — 구 버전 코드는 이 컬럼을 읽지도 쓰지도 않는다.
ALTER TABLE chat_message ADD COLUMN options jsonb NULL;

COMMENT ON COLUMN chat_message.options IS
  'WP-1569: AI 질문 글의 답 선택지(JSON 문자열 배열 2~4개). 없으면 NULL';

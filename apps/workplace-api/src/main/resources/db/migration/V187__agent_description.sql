-- WP-455: AI 구성원의 설명(역할) — 무엇을 맡고 어떻게 일하는지 관리자가 적는다.
-- 다른 AI 가 MCP 구성원 조회로 이 글을 읽고 일을 맡길 상대를 고른다(A2A Agent Card 의 description 에 해당).
-- expand 단계: NULL 허용이라 구 버전 코드(컬럼을 모름)도 그대로 동작한다. HUMAN 행은 쓰지 않는다.
ALTER TABLE "user"
  ADD COLUMN description VARCHAR(500);

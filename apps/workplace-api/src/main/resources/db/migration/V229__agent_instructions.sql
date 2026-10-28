-- WP-1077: AI 구성원의 지시 — 그 AI 자신이 이슈를 맡을 때마다 따르는 규칙. 관리자가 적는다.
-- 설명(description, V187)은 다른 AI 가 맡길 상대를 고를 때 읽고, 지시는 본인 조회(GET /members/{내 id})에서만 내려간다.
-- expand 단계: NULL 허용이라 구 버전 코드(컬럼을 모름)도 그대로 동작한다. HUMAN 행은 쓰지 않는다.
ALTER TABLE "user"
  ADD COLUMN instructions VARCHAR(4000);

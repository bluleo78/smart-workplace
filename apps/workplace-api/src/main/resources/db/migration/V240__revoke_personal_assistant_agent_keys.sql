-- WP-1162: 관리자가 개인 비서(__assistant_u<id>)에게 발급해 둔 AI API 키를 회수한다.
-- WP-1153 이 발급을 막고 인증 필터에서 그 키를 거절하지만, DB 에는 「활성」으로 남아 관리 화면·키 수 세기에 계속 잡혔다.
-- 개인 비서는 주인의 위임으로만 움직여 이 키들은 쓸 데가 없다 — 한 번 돌아 revoked_at 을 찍는다(데이터만 바꾸므로 구·신 버전이 함께 돌아도 안전).
-- LIKE 의 '_' 는 한 글자 와일드카드라 접두어(AgentUsernames.PERSONAL_ASSISTANT_PREFIX)의 밑줄을 이스케이프한다.
UPDATE agent_api_key k
SET revoked_at = now()
FROM "user" u
WHERE k.user_id = u.id
  AND k.revoked_at IS NULL
  AND u.username LIKE '\_\_assistant\_u%' ESCAPE '\';

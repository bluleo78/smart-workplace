-- WP-1163: 개인 비서(username 접두어 __assistant_u)를 공통 비서로 지정한 행을 정리한다.
-- 관리자가 구성원의 개인 비서를 공통 비서로 지정할 수 있어, 개인 비서가 없는 구성원 모두의 홈 AI 대화가 주인 모르게 그 사람의 토큰으로 돌았다.
-- 코드는 이제 지정을 막는다(403) — 이미 들어간 지정만 지운다. 그 워크스페이스는 공통 비서 미지정이 되고 관리자가 다른 AI 를 지정하면 된다.
-- 데이터만 지우므로 구·신 버전이 함께 돌아도 안전하다. 소유자 app 은 BYPASSRLS 라 전 테넌트에 적용된다.
-- LIKE 의 _ 는 한 글자 와일드카드라 이스케이프한다.
DELETE FROM workspace_assistant wa
USING "user" u
WHERE u.id = wa.agent_user_id
  AND u.username LIKE '\_\_assistant\_u%';

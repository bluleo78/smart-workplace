-- WP-1170: 주인이 아닌 사람이 바꿔 둔 개인 비서(__assistant_u<주인 id>) AI 연결을 회수하고 주인에게 알린다.
-- WP-1163 이 관리자의 개인 비서 연결 등록을 막았지만, 그 전에 관리자가 남의 개인 비서 연결을 자기 토큰으로 바꿔 둔 행
-- (created_by ≠ 주인)은 그대로 남아 주인의 대화가 주인 모르게 그 사람의 연결로 계속 나갔다.
-- 알림은 그 연결을 바꾼 사람과 주인이 함께 속한 워크스페이스마다 한 건(PERSONAL_ASSISTANT_REVOKED, 행위자 없음 — 정리가 한 일이라).
-- 연결 데이터만 바꾸고 알림 행만 더하므로 구·신 버전이 함께 돌아도 안전하다(구 버전은 모르는 알림 종류를 그대로 지나친다).
-- LIKE 의 '_' 는 한 글자 와일드카드라 접두어(AgentUsernames.PERSONAL_ASSISTANT_PREFIX)의 밑줄을 이스케이프한다.
WITH revoked AS (
  UPDATE ai_agent_credential c
     SET revoked_at = now()
    FROM "user" a
   WHERE c.user_id = a.id
     AND c.revoked_at IS NULL
     AND a.username LIKE '\_\_assistant\_u%' ESCAPE '\'
     AND substring(a.username FROM 14) ~ '^[0-9]+$'
     AND c.created_by <> substring(a.username FROM 14)::bigint
  RETURNING substring(a.username FROM 14)::bigint AS owner_id, c.created_by
)
INSERT INTO notification (tenant_id, recipient_id, actor_id, type)
SELECT DISTINCT mo.tenant_id, r.owner_id, NULL::bigint, 'PERSONAL_ASSISTANT_REVOKED'
  FROM revoked r
  JOIN "user" o ON o.id = r.owner_id
  JOIN membership mo ON mo.user_id = r.owner_id AND mo.status = 'ACTIVE'
  JOIN membership mc ON mc.user_id = r.created_by AND mc.tenant_id = mo.tenant_id;

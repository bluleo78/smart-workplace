-- WP-371: "이 에이전트가 어느 테넌트에서든 공통 비서인가" 를 테넌트 경계 없이 확인하는 함수.
-- workspace_assistant 는 RLS(V66)라 현재 테넌트 행만 보인다. 에이전트(user)는 전역이라 여러 테넌트의 멤버가 될 수 있고,
-- 다른 테넌트의 공통 비서로 쓰이는 에이전트를 EXTERNAL 로 바꾸면 그 테넌트의 AI Chat 이 멈춘다 — 그래서 RLS 를 우회해 존재 여부만 돌려준다.
-- 소유자 app(BYPASSRLS) 가 소유하는 SECURITY DEFINER 라 RLS 를 우회한다(V78 drive_share_link_resolve 와 같은 패턴).
-- 반환은 boolean 하나뿐이라 다른 테넌트의 데이터(누가 지정했는지 등)는 노출되지 않는다.
CREATE FUNCTION is_workspace_assistant_agent(p_agent_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM workspace_assistant WHERE agent_user_id = p_agent_id) $$;
-- 기본 PUBLIC EXECUTE 를 회수하고 런타임 롤에만 연다(V163 과 동일).
REVOKE ALL ON FUNCTION is_workspace_assistant_agent(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_workspace_assistant_agent(BIGINT) TO app_tenant;

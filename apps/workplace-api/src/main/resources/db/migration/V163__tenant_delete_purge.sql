-- WP-341 테넌트 삭제·영구 삭제.
-- 1) 상태 확장: DELETED(삭제됨·복원 가능), PURGING(영구 삭제 진행 중).
ALTER TABLE tenant DROP CONSTRAINT tenant_status_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_status_check
  CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED', 'PURGING'));

-- 2) 삭제 시각(복원 시 NULL)과 마지막 영구 삭제 실패 사유(성공·재시도 시작 시 NULL).
ALTER TABLE tenant ADD COLUMN deleted_at  TIMESTAMP NULL;
ALTER TABLE tenant ADD COLUMN purge_error TEXT      NULL;
COMMENT ON COLUMN tenant.deleted_at  IS '삭제(DELETED) 전환 시각. 복원 시 NULL.';
COMMENT ON COLUMN tenant.purge_error IS '마지막 영구 삭제 실패 사유. 재시도 시작·성공 시 NULL.';

-- 3) tenant 행 최종 삭제. app_tenant 는 tenant·membership DELETE 권한이 없으므로(V46) 소유자(app) 권한 함수로 수행한다.
--    SECURITY DEFINER 는 RLS 를 우회하므로 모든 문장에 대상 조건을 명시한다. status='PURGING' 이 아니면 아무것도 하지 않는다.
--    테넌트 데이터 테이블은 호출 전에 애플리케이션이 GUC 아래에서 비워 두어야 한다(NO ACTION FK 가 남은 행을 잡아 실패시킨다).
CREATE FUNCTION purge_tenant(p_tenant_id BIGINT, p_agent_user_ids BIGINT[])
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agents BIGINT[];
  v_agent  BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = p_tenant_id AND status = 'PURGING') THEN
    RETURN FALSE;
  END IF;

  -- 삭제 대상 AGENT 를 "이 테넌트 멤버이면서 다른 테넌트 멤버십은 없고, 다른 테넌트에도 소속된 사람의 개인 비서도 아닌 AGENT" 로 좁힌다.
  -- 호출자가 넘긴 id 를 그대로 믿지 않는다 — 무관한(이 테넌트 비소속) AGENT id 가 섞여도 지워지지 않게 한다.
  SELECT COALESCE(array_agg(u.id), '{}') INTO v_agents
    FROM "user" u
   WHERE u.id = ANY(p_agent_user_ids)
     AND u.kind = 'AGENT'
     AND EXISTS (SELECT 1 FROM membership m WHERE m.user_id = u.id AND m.tenant_id = p_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.user_id = u.id AND m.tenant_id <> p_tenant_id)
     -- 개인 비서 AGENT 는 사용자 단위 전역 계정이다 — 멤버십은 처음 등록한 테넌트에만 있지만 다른 테넌트에서도 주인 기준으로 쓰인다.
     -- 주인(사람)이 다른 테넌트에도 소속돼 있으면 계정·자격 증명·링크를 남긴다(이 테넌트 멤버십만 tenant CASCADE 로 사라진다).
     AND NOT EXISTS (
       SELECT 1 FROM "user" h
        WHERE h.personal_assistant_agent_id = u.id
          AND EXISTS (SELECT 1 FROM membership m WHERE m.user_id = h.id AND m.tenant_id <> p_tenant_id));

  -- 개인 비서 링크(NO ACTION FK)를 끊는다 — 남아 있으면 AGENT 삭제가 실패한다.
  UPDATE "user" SET personal_assistant_agent_id = NULL WHERE personal_assistant_agent_id = ANY(v_agents);
  -- agent_api_key·ai_agent_credential(user_id)은 user FK CASCADE 로 함께 삭제된다.
  -- AGENT 를 하나씩 지운다: 다른 곳의 NO ACTION 참조(예: created_by)에 막힌 AGENT 는 자기만 건너뛰고(서브트랜잭션 롤백)
  -- 나머지 AGENT 와 테넌트 삭제는 진행한다 — 재시도마다 같은 이유로 영구히 막히지 않게.
  FOREACH v_agent IN ARRAY v_agents LOOP
    BEGIN
      DELETE FROM "user" WHERE id = v_agent;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'purge_tenant(%): AGENT % 계정 삭제 건너뜀(계정 비활성화) — %', p_tenant_id, v_agent, SQLERRM;
      -- 계정이 전역 고아로 남더라도 어떤 경로로도 인증할 수 없게 이 AGENT 의 API 키·OAuth 자격을 지우고
      -- 계정 자체를 비활성화(is_active=false)한다 — 비밀번호 로그인·refresh 는 비활성 계정을 거절하고, 남은 계정은 멤버십·자격 증명도
      -- 없어 다른 경로에서도 테넌트 컨텍스트를 얻지 못한다(이중 방어).
      -- 이 정리의 실패가 영구 삭제 전체를 막지 않도록 별도 서브트랜잭션으로 감싼다.
      BEGIN
        DELETE FROM agent_api_key WHERE user_id = v_agent;
        DELETE FROM ai_agent_credential WHERE user_id = v_agent;
        UPDATE "user" SET is_active = false WHERE id = v_agent;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'purge_tenant(%): AGENT % 인증 수단 정리·비활성화 실패 — %', p_tenant_id, v_agent, SQLERRM;
      END;
    END;
  END LOOP;
  -- membership·user_api_token 은 tenant FK CASCADE 로 함께 삭제된다.
  DELETE FROM tenant WHERE id = p_tenant_id AND status = 'PURGING';
  RETURN TRUE;
END $$;
-- 기본 PUBLIC EXECUTE 를 회수하고 런타임 롤에만 연다(SECURITY DEFINER 함수의 호출자를 좁힌다).
REVOKE ALL ON FUNCTION purge_tenant(BIGINT, BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_tenant(BIGINT, BIGINT[]) TO app_tenant;

-- V250__agent_api_key_managed.sql
-- WP-1253: Works 가 작업 공간에 띄운 AI 의 키를 Works 가 직접 발급·교체·폐기한다.
--   managed             : Works 가 runner 요청으로 자동 발급한 키(관리자 목록에 「Works 자동 발급」으로 보인다)
--   expires_at          : 이 시각이 지나면 인증되지 않는다(관리자가 발급한 키는 NULL = 만료 없음).
--                         활성 키 = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now)
--   rotation_generation : 이 키가 맞춰진 실행 설정 generation(교체 발급이면 올린 값, 아니면 발급 때 값) — 그 generation 의 Pod 가
--                         관찰되면(observedGeneration ≥ 이 값) 「쓰인 키」로 보고 그 AI 의 옛 managed 키를 정리 유예로 줄인다.
--                         그 전에 같은 generation 으로 다시 요청하면 전달되지 않은 재시도로 본다
--   tenant_id           : managed 키를 발급한 워크스페이스(managed 키에만 넣고 관리자 발급 키는 NULL).
--                         같은 AI 를 두 워크스페이스에서 Works 가 띄우면 키 사슬이 워크스페이스마다 따로다 — 한쪽의 교체·정리·끄기가
--                         다른 쪽 Pod 의 키를 끊지 않게. 인증 때도 이 키는 이 워크스페이스로만 들어간다(ApiKeyAuthenticationFilter).
--                         이 테이블은 해시 조회 때문에 RLS 를 켜지 않는 전역 키 테이블이라(V14) GUC 기본값을 두지 않고 앱이 명시해 넣는다.
--                         워크스페이스 영구 삭제 때는 tenant FK CASCADE 로 함께 지워진다(user_api_token 과 같은 방식, TenantPurgePlan.EXCLUDED).
-- created_by 는 NULL 을 허용한다 — 자동 발급에는 발급한 사람이 없다. 제약을 푸는 것뿐이라 옛 버전 코드(늘 값을 넣음)와 함께 돌아도 된다.
ALTER TABLE agent_api_key
  ADD COLUMN managed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN rotation_generation BIGINT,
  ADD COLUMN tenant_id BIGINT REFERENCES tenant(id) ON DELETE CASCADE;
ALTER TABLE agent_api_key ALTER COLUMN created_by DROP NOT NULL;
-- managed 키는 반드시 워크스페이스에 묶인다 — 묶이지 않은 managed 키가 생기면 워크스페이스별 정리가 닿지 않는다.
ALTER TABLE agent_api_key
  ADD CONSTRAINT ck_agent_api_key_managed_tenant CHECK (NOT managed OR tenant_id IS NOT NULL);

-- AI·워크스페이스별 활성 managed 키 조회(desired 의 agent-key 버전, 교체 판정, 정리)용 — 조회가 id 오름차순이라 방향을 두지 않는다.
CREATE INDEX idx_agent_api_key_managed ON agent_api_key(user_id, tenant_id, id)
  WHERE managed AND revoked_at IS NULL;

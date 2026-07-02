-- 사용자 PAT(Personal Access Token) 테이블. 외부 클라이언트(Claude Code 등 MCP)가
-- 사용자 본인 권한으로 API 를 호출할 때 쓰는 장기 토큰이다.
-- agent_api_key(V14) 미러 — 비-RLS 글로벌 테이블. 인증 hot path 가 테넌트 GUC 주입 전에
-- 해시 조회를 해야 하므로 RLS 를 걸 수 없다. 대신 tenant_id 를 발급 시점의 활성 테넌트로
-- 바인딩하고, 인증 필터가 사용자의 ACTIVE 멤버십과 대조 검증 후에만 TenantContext 를 설정한다.
CREATE TABLE user_api_token (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id     BIGINT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name          VARCHAR(80) NOT NULL,
  token_prefix  VARCHAR(16) NOT NULL,
  token_hash    VARCHAR(128) NOT NULL,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_user_api_token_user ON user_api_token(user_id);
-- 인증 hot path: 활성 토큰만 해시로 좁힌다 (agent_api_key 와 동일 패턴).
CREATE INDEX idx_user_api_token_hash ON user_api_token(token_hash) WHERE revoked_at IS NULL;

-- V14__agent_users.sql
-- Phase 5a: AGENT 유저 타입 + API 키 테이블.
-- 사람과 AI 가 같은 user 테이블을 공유하면서 kind 컬럼으로 구분한다.

-- 1) user.kind 추가 (HUMAN | AGENT)
ALTER TABLE "user" ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "user" ADD CONSTRAINT user_kind_check
  CHECK (kind IN ('HUMAN', 'AGENT'));
CREATE INDEX idx_user_kind ON "user"(kind);

-- 2) AGENT 는 password NULL 허용 (로그인 불가, API 키로만 인증)
ALTER TABLE "user" ALTER COLUMN password DROP NOT NULL;

-- 3) AGENT API 키 테이블
--    key_hash 는 SHA-256 hex (64 chars), plaintext 는 절대 저장하지 않는다.
--    revoked_at IS NULL 인 키만 인증에 사용되며 인덱스도 그 조건으로 좁힌다.
CREATE TABLE agent_api_key (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key_prefix    VARCHAR(16) NOT NULL,
  key_hash      VARCHAR(128) NOT NULL,
  label         VARCHAR(80),
  created_by    BIGINT NOT NULL REFERENCES "user"(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_agent_api_key_user ON agent_api_key(user_id);
CREATE INDEX idx_agent_api_key_hash ON agent_api_key(key_hash) WHERE revoked_at IS NULL;

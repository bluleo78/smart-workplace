-- Phase 5c-2 후속 (#33): AGENT 의 Claude CLI OAuth 토큰 암호화 저장.
-- agent_api_key 와 같은 lifecycle 컬럼 패턴 (label/created_by/created_at/last_used_at/revoked_at)
-- 을 따르되, 인증용 hash 가 아니라 복호화해 child process 에 넘기는 자격증명이라
-- encrypted_token 을 둔다. EncryptionService 의 'iv:ciphertext' 포맷.

CREATE TABLE ai_agent_credential (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  encrypted_token  TEXT   NOT NULL,
  label            VARCHAR(80),
  created_by       BIGINT NOT NULL REFERENCES "user"(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ
);

CREATE INDEX idx_aac_user ON ai_agent_credential(user_id);

-- 한 AGENT 당 active(=revoked_at IS NULL) 행 1개 보장 — application 분기 실수 방어.
CREATE UNIQUE INDEX uq_aac_active
  ON ai_agent_credential(user_id) WHERE revoked_at IS NULL;

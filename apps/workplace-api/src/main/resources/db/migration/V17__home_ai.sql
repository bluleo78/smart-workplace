-- V17__home_ai.sql
-- 홈 AI Chat: 사용자별 대화 세션 + 메시지(역할/본문/위젯 스펙). 캔버스 복원 원천.
CREATE TABLE home_session (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_home_session_user ON home_session(user_id, last_message_at DESC);

CREATE TABLE home_message (
  id          BIGSERIAL    PRIMARY KEY,
  session_id  UUID         NOT NULL REFERENCES home_session(id) ON DELETE CASCADE,
  role        VARCHAR(16)  NOT NULL,          -- 'USER' | 'ASSISTANT'
  content     TEXT         NOT NULL,
  widgets     JSONB,                          -- ASSISTANT: [{type,params,layout}] = 캔버스 복원 원천
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_home_message_session ON home_message(session_id, created_at);

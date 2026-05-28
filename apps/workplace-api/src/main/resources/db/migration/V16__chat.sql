-- V16__chat.sql
-- chat 도메인: 이슈당 1개 thread, 메시지, 멤버십.

CREATE TABLE chat_thread (
  id            BIGSERIAL PRIMARY KEY,
  issue_id      BIGINT NOT NULL UNIQUE REFERENCES issue(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);

CREATE TABLE chat_thread_member (
  thread_id              BIGINT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  user_id                BIGINT NOT NULL REFERENCES "user"(id),
  last_read_message_id   BIGINT,
  joined_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX idx_chat_thread_member_user ON chat_thread_member(user_id);

CREATE TABLE chat_message (
  id            BIGSERIAL PRIMARY KEY,
  thread_id     BIGINT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  author_id     BIGINT NOT NULL REFERENCES "user"(id),
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  mentions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_chat_message_thread_created ON chat_message(thread_id, created_at DESC, id DESC);

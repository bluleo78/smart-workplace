-- V27__messaging_threads_reactions.sql
-- messaging Phase 5: 스레드 답글(자기참조) + 이모지 리액션.

-- 스레드 답글: 부모 메시지 자기참조. NULL = 채널 최상위 메시지, 값 있으면 답글.
ALTER TABLE message ADD COLUMN parent_message_id BIGINT REFERENCES message(id) ON DELETE CASCADE;
-- 스레드 페이지 조회용(부모별 시간순). 부분 인덱스로 최상위 메시지는 제외.
CREATE INDEX idx_message_parent ON message(parent_message_id, created_at, id)
  WHERE parent_message_id IS NOT NULL;

-- 이모지 리액션: (메시지, 사용자, 이모지) 유니크 → 토글은 insert/delete.
CREATE TABLE message_reaction (
  message_id BIGINT      NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  emoji      TEXT        NOT NULL CHECK (length(emoji) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX idx_reaction_message ON message_reaction(message_id);

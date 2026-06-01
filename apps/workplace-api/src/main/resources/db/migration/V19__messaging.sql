-- V19__messaging.sql
-- messaging 도메인: 팀 채팅 채널/멤버/메시지. chat(이슈 종속)과 별개.
-- Phase 1 은 kind='CHANNEL', visibility='PUBLIC' 만 사용. 나머지 값은 후속 페이즈(DM/PRIVATE) 대비.
-- actor 종류(HUMAN/AGENT)는 "user".kind 로 파생 — 별도 컬럼 없음.

CREATE TABLE channel (
  id          BIGSERIAL PRIMARY KEY,
  kind        VARCHAR(16) NOT NULL DEFAULT 'CHANNEL',
  name        VARCHAR(80),
  visibility  VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
  created_by  BIGINT NOT NULL REFERENCES "user"(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE channel_member (
  channel_id           BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  user_id              BIGINT NOT NULL REFERENCES "user"(id),
  last_read_message_id BIGINT,
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_member_user ON channel_member(user_id);

CREATE TABLE message (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  author_id   BIGINT NOT NULL REFERENCES "user"(id),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_message_channel_created ON message(channel_id, created_at DESC, id DESC);

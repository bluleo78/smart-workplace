-- notification: 인앱 알림 인박스. recipient 스코프로 격리.
-- 표시용 이름/제목(액터명·이슈키·제목)은 읽을 때 issue·project·user 조인 — 스냅샷 비정규화 안 함.
CREATE TABLE notification (
  id            BIGSERIAL PRIMARY KEY,
  recipient_id  BIGINT NOT NULL REFERENCES "user"(id),
  actor_id      BIGINT     REFERENCES "user"(id),   -- 사람/AI 행위자. 시스템이면 null
  type          VARCHAR(32) NOT NULL,               -- ASSIGNED | COMMENTED | STATUS_CHANGED
  issue_id      BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  comment_id    BIGINT,                             -- COMMENTED 시
  read_at       TIMESTAMPTZ,                        -- null = 안읽음
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 최신순 목록 조회
CREATE INDEX idx_notification_recipient_created ON notification(recipient_id, created_at DESC);
-- 안읽음 카운트(부분 인덱스)
CREATE INDEX idx_notification_unread ON notification(recipient_id) WHERE read_at IS NULL;

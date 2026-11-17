-- V300 (WP-1689): 읽은 알림 보관 — 처리한(읽은) 알림을 목록에서 치우는 시각. 컬럼 추가 + 인덱스 정비(롤링 배포 호환).
--   archived_at: NULL = 목록(인박스)에 보임. 값이 있으면 보관함으로 간 알림 — 목록·안 읽은 수에서 뺀다.
--     읽은 알림만 보관하므로 read_at 은 건드리지 않는다. 되돌리기는 NULL 로 지운다.
--     새 알림은 늘 새 행(insertBatch)이라 보관과 부딪히지 않는다.
-- 인덱스: 목록·안 읽은 수는 이제 늘 archived_at IS NULL 로 거르므로 그 조건의 부분 인덱스를 새 이름으로 더하고,
--   보관함·90일 정리용과 자동 보관(읽은 지 7일, WP-1690)용 인덱스를 더한다.
--   기존 idx_notification_unread·idx_notification_recipient_created 는 남긴다(롤링 배포 호환 — 배포 중 남은 옛 파드의 쿼리는
--   archived_at 조건이 없어 새 부분 인덱스를 못 쓴다). 두 옛 인덱스는 다음 마이그레이션에서 DROP 한다.
ALTER TABLE notification ADD COLUMN archived_at TIMESTAMPTZ;

-- 안 읽은 수 — 보관되지 않은 안 읽은 알림만(옛 idx_notification_unread 를 대신함)
CREATE INDEX idx_notification_unread_active ON notification(recipient_id)
  WHERE read_at IS NULL AND archived_at IS NULL;

-- 최신순 목록 — 보관되지 않은 알림만(옛 idx_notification_recipient_created 를 대신함)
CREATE INDEX idx_notification_recipient_created_active ON notification(recipient_id, created_at DESC)
  WHERE archived_at IS NULL;

-- 보관함 목록(최근 보관순)·보관 90일 정리
CREATE INDEX idx_notification_recipient_archived ON notification(recipient_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- 자동 보관 — 읽었고 아직 보관되지 않은 알림을 읽은 시각으로 고른다
CREATE INDEX idx_notification_read_unarchived ON notification(read_at)
  WHERE archived_at IS NULL AND read_at IS NOT NULL;

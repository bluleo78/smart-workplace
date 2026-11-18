-- V306 (WP-1695): 알림 보관(V300, WP-1689) 뒤 쓰이지 않게 된 옛 인덱스 두 개를 지운다(expand/contract 의 contract).
--   V300 은 목록·안 읽은 수가 늘 archived_at IS NULL 로 거르게 되면서 그 조건의 부분 인덱스
--   idx_notification_unread_active·idx_notification_recipient_created_active 를 새 이름으로 만들고,
--   롤링 배포 중 옛 파드(archived_at 조건 없는 쿼리)가 쓰도록 옛 두 인덱스는 남겼다.
--   WP-1689 가 운영에 모두 반영됐으므로(v0.9.72) 옛 인덱스는 쓰기 비용만 남는다.
-- 롤링 배포 호환: 이 버전과 바로 앞 버전 모두 새 _active 인덱스를 쓰므로 지워도 조회가 느려지지 않는다.
DROP INDEX IF EXISTS idx_notification_unread;
DROP INDEX IF EXISTS idx_notification_recipient_created;

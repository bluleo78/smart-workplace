-- V302 (WP-1690): 보관 90일 정리용 인덱스.
--   정리 작업(NotificationRepository.deleteArchivedBefore)은 수신자와 상관없이 archived_at < cutoff 만으로 고른다.
--   V300 의 idx_notification_recipient_archived 는 recipient_id 로 시작해 이 조건에 쓸 수 없어, 묶음(1000건)마다 표 전체를
--   훑게 된다. archived_at 만으로 된 부분 인덱스(보관된 행만)를 더해 범위 검색으로 바꾼다.
-- 롤링 배포 호환: 인덱스 추가뿐이라 옛 파드 쿼리에 영향이 없다.
CREATE INDEX idx_notification_archived_at ON notification(archived_at)
  WHERE archived_at IS NOT NULL;

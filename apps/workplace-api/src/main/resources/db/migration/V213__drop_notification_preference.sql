-- WP-934: 옛 종류별 푸시 설정 테이블을 걷어낸다(expand/contract 의 contract 단계).
-- WP-913(V207) 부터 알림·푸시를 받을지는 notification_setting·notification_app_setting 이 정하고,
-- notification_preference 는 롤링 배포 중 옛 웹 화면(/api/v1/push/preferences)이 깨지지 않게만 남겨 두었다.
-- 새 웹이 운영에 배포되어 엔드포인트와 함께 테이블도 제거한다(남은 행은 판정에 쓰이지 않던 값이라 옮기지 않는다).
DROP TABLE IF EXISTS notification_preference;

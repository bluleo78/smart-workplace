-- V207: 앱·항목·행위자별 알림 설정(WP-913).
--
-- 1) notification_setting — (사용자, 항목, 행위자 열) 한 칸의 켜짐/꺼짐. 사용자가 바꾼 칸만 저장하고, 행이 없으면
--    코드 상수(NotificationSettingItem)의 기본값을 따른다 — 기본값을 바꾸면 손대지 않은 사용자에게 바로 반영된다.
--    item 에는 CHECK 를 두지 않는다. V137 의 category CHECK 때문에 노트 알림을 MENTION 에 끼워 넣어야 했던 전례가 있어,
--    항목 목록은 코드 enum 이 정한다(모르는 값이 남아 있으면 읽는 쪽이 무시).
-- 2) notification_app_setting — 앱(ISSUE·CHAT·CALENDAR·WIKI) 전체 스위치. 끄면 그 앱의 모든 칸이 꺼진 것과 같지만
--    칸 값은 그대로 두어 다시 켜면 복원된다. 행이 없으면 켜짐.
--    두 테이블 모두 사용자 단위 글로벌(비-RLS) — V137 의 notification_preference 와 같은 범위(테넌트 미선택 토큰으로도 읽고 쓴다).
--    app_tenant 권한은 V44 DEFAULT PRIVILEGES 로 자동 부여된다.
-- 3) notification.agent_work_state — AI 작업 상태 알림의 원인 상태(INPUT_REQUIRED 등). 후속 태스크가 채우는 nullable 칸이라
--    추가만으로 구·신 파드 공존이 안전하다(expand).
--
-- 옛 /api/v1/push/preferences 와 notification_preference 는 남아 있으나 알림·푸시 판정에 쓰지 않는다.
-- 엔드포인트·코드·테이블 제거는 후속 이슈에서 한다(expand/contract — 롤링 배포 중 옛 웹 화면이 깨지지 않게).

-- 1)
CREATE TABLE notification_setting (
  user_id  BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  item     VARCHAR(64) NOT NULL,   -- NotificationSettingItem.name()
  actor    VARCHAR(8)  NOT NULL CHECK (actor IN ('HUMAN', 'AGENT')),  -- 「사람이」/「AI가」 열
  enabled  BOOLEAN     NOT NULL,
  PRIMARY KEY (user_id, item, actor)
);

-- 2)
CREATE TABLE notification_app_setting (
  user_id  BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  app      VARCHAR(16) NOT NULL,   -- NotificationApp.name()
  enabled  BOOLEAN     NOT NULL,
  PRIMARY KEY (user_id, app)
);

-- 3)
ALTER TABLE notification ADD COLUMN agent_work_state VARCHAR(20);

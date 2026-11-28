-- V348 (WP-2171): 「새 일정을 Outlook 캘린더에 만들까요?」를 사람당 한 번만 묻기 위한 기록.
-- 칼럼만 더한다(NULL 허용 — 롤링 배포 호환: 옛 코드는 이 칼럼을 모른다).
--   - outlook_prompted_at: 그 질문을 한 시각. NULL 이면 아직 묻지 않았다.
ALTER TABLE calendar_user_setting ADD COLUMN outlook_prompted_at timestamptz NULL;

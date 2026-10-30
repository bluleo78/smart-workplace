-- WP-1220: 캘린더 태그를 누가 만들었는지 남긴다 — APP = 사용자가 앱에서 만듦, OUTLOOK = Outlook 범주 동기화가 새로 만듦.
-- M365 계정 연결을 끊으면 그 계정의 일정·연결은 CASCADE 로 사라지지만 태그 행은 남아 「일정 0개」 태그가 쌓였다. 정리하려면
-- 동기화가 만든 태그와 사용자가 만든 태그(동기화가 같은 이름으로 재사용했을 수 있다)를 가려야 하는데, 지금은 그 표시가 없다.
--
-- 롤링 배포 호환(expand only): 컬럼 기본값이 APP 이라 옛 파드가 만드는 태그는 APP(지우지 않는 쪽)으로 남는다.
-- 기존 행은 채우지 않는다(모두 APP) — 출처를 확실히 알 수 없는 태그를 지우지 않기 위해서다. 배포 전에 생긴 범주 태그는 자동 정리되지 않는다.
ALTER TABLE calendar_tag
  ADD COLUMN origin VARCHAR(10) NOT NULL DEFAULT 'APP' CHECK (origin IN ('APP', 'OUTLOOK'));

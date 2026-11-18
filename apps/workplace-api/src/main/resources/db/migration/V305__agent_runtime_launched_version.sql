-- WP-1706: 지금 generation 을 띄운(띄울) 작업 공간 이미지·genia-works 플러그인 버전.
-- 릴리스가 이 값을 바꾸면 API 기동 비교가 켜진 AI 의 generation 을 올려 쉴 때 새 버전으로 다시 띄운다. null = 기록 없음(첫 배포).
-- 롤링 배포 호환: null 허용·기본값 없음 — 옛 API 는 이 칸을 모른다.
alter table agent_runtime_setting
  add column runtime_image text,
  add column runtime_plugin_version text;

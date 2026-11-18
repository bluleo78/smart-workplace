-- V303 (WP-1707): 외부 AI 가 쓰는 genia-works 플러그인 버전을 키마다 남긴다.
--   plugin_version    : 그 키로 온 요청의 X-Genia-Plugin-Version(점과 숫자, 32자 이하 — 앱이 검사). 보고가 없으면 NULL.
--   plugin_version_at : plugin_version 이 마지막으로 바뀐 시각 — 같은 값이 다시 오면 고치지 않는다.
-- 관리 화면이 최신 버전(AGENT_PLUGIN_VERSION)과 견줘 「업데이트 필요」를 보인다. 마지막 접속(last_used_at)을 갱신하는 같은 UPDATE 에서 쓴다.
-- 롤링 배포 호환: NULL 허용 칸 추가뿐이라 옛 파드 쿼리(이 칸을 모름)에 영향이 없다.
ALTER TABLE agent_api_key
  ADD COLUMN plugin_version VARCHAR(32),
  ADD COLUMN plugin_version_at TIMESTAMPTZ;

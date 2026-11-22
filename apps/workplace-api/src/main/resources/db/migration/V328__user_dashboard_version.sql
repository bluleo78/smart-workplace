-- WP-1953: 홈 대시보드 레이아웃 낙관적 동시성 version.
-- 기존 행은 0 으로 시작한다(행 없음의 GET 도 0). 저장 성공마다 +1.
-- 컬럼 추가(NOT NULL DEFAULT) 만이라 롤링 배포 중 옛 앱이 읽고 쓰는 데 영향이 없다(옛 앱은 version 을 안 건드림).
ALTER TABLE user_dashboard ADD COLUMN version bigint NOT NULL DEFAULT 0;

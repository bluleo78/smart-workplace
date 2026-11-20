-- V321__agent_location_quota_capacity.sql
-- WP-1819: 실행 위치(클러스터 네임스페이스)의 리소스 쿼터 상한으로 띄울 수 있는 최대 AI 수(사용분은 빼지 않은 총량)를 runner 관찰 보고로 받아 둔다.
--   quota_capacity : N 쿼터로 띄울 수 있는 AI 수 · NULL 쿼터 없음 또는 아직 모름(보고 전·옛 runner).
-- 칸 추가만이라 옛 버전 코드와 함께 돌아도 된다(롤링 배포 호환).
ALTER TABLE agent_location ADD COLUMN quota_capacity INTEGER NULL;
COMMENT ON COLUMN agent_location.quota_capacity IS '클러스터 쿼터 상한으로 띄울 수 있는 최대 AI 수(사용분은 빼지 않은 총량, runner 보고). NULL 은 쿼터 없음 또는 아직 모름';

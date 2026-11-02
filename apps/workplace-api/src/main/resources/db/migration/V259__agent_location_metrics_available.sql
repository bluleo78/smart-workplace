-- V256__agent_location_metrics_available.sql
-- WP-1280: 실행 위치에서 CPU·메모리 사용량을 잴 수 있는지(metrics.k8s.io 가 있는지)를 runner 관찰 보고로 받아 둔다.
--   metrics_available : true 잴 수 있음 · false 그 클러스터에 사용량 API(metrics-server)가 없음 · NULL 아직 모름(보고 전·옛 runner).
-- 일시 오류는 runner 가 값을 보내지 않아 마지막 값이 남는다. 칸 추가만이라 옛 버전 코드와 함께 돌아도 된다(롤링 배포 호환).
ALTER TABLE agent_location ADD COLUMN metrics_available BOOLEAN;

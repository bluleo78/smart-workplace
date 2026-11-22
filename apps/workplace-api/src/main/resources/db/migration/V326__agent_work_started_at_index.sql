-- WP-1831: AI 현황 조회가 agent_work 를 시간 범위로 훑을 때 쓰는 조회용 인덱스(조회 전용 — expand, 기존 코드에 영향 없음).
-- 두 곳이 started_at 을 기준으로 행을 고른다.
--   1) AiStatusQueryRepository.delegated  : started_at < to AND (ended_at IS NULL OR ended_at >= from)
--   2) AiStatusQueryRepository.listRuns   : started_at >= from AND started_at < to (처리 이력 목록의 위임 작업 분기)
-- RLS 가 tenant_id 로 거르므로 선두를 tenant_id 로 두어 「테넌트 필터 + started_at 범위」를 한 번에 해결한다.
-- 기존 idx_agent_work_tenant(tenant_id) 는 단일 열이라 범위 조건을 못 거른다 — 새 인덱스와 겹치지 않으니 그대로 둔다.
CREATE INDEX IF NOT EXISTS agent_work_tenant_started_idx ON agent_work (tenant_id, started_at);
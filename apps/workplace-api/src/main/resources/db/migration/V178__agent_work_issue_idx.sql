-- WP-396: AI 위임 작업 목록 — 이슈별 작업 기록 조회(작업 기록 있는 이슈 사전 필터, 이슈마다 작업을 한 번에 집계하는 LATERAL).
-- 기존 issue_id 인덱스(agent_work_active_uq)는 진행 중(ended_at IS NULL) 부분 인덱스라 종료 행까지 이슈로 찾을 길이 없었다.
-- 종료 행은 지우지 않아 계속 쌓이므로 진행 중·종료를 모두 덮는 일반 인덱스로 둔다. 뒤의 (ended_at DESC, id DESC)는 이슈 안 최근 종료순.
-- 추가만 하므로 구 버전과 공존해도 안전하다.
-- main 재작성(rebase) 때 WP-383 의 V175 와 번호가 겹쳐 V178 로 옮겼다 — 이미 V175 로 적용된 로컬 DB 를 위해 IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS agent_work_issue_idx ON agent_work(issue_id, ended_at DESC, id DESC);

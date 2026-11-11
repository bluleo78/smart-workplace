-- WP-1476: 이슈 성과 지표 조회용 인덱스(추가만 — expand 전용, 구 코드에 영향 없음).
-- 프로젝트 기준 완료 후보: project_id + closed_at 범위(기간·지난 기간을 한 번에). 완료(DONE)만 보므로 부분 인덱스. 기존 project_id 인덱스들은 closed_at 을 담지 않는다.
CREATE INDEX IF NOT EXISTS idx_issue_project_closed ON issue(project_id, closed_at) WHERE deleted_at IS NULL AND status = 'DONE';
-- 사람 기준 「새로 생김」: reporter_id + created_at 범위. reporter_id 인덱스가 없었다.
CREATE INDEX IF NOT EXISTS idx_issue_reporter_created ON issue(reporter_id, created_at) WHERE deleted_at IS NULL;
-- agent_work(issue_id) 는 만들지 않는다 — V178 agent_work_issue_idx(issue_id, ended_at DESC, id DESC) 가 issue_id 선두라 그대로 쓴다.
-- 사람 기준 완료 후보: 프로젝트를 가로지르는 DONE + closed_at 범위. 담당·읽기 조건은 그 뒤에 거른다(부분 인덱스라 작다).
CREATE INDEX IF NOT EXISTS idx_issue_done_closed ON issue(closed_at) WHERE deleted_at IS NULL AND status = 'DONE';

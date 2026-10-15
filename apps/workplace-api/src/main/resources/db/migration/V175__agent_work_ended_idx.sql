-- WP-396: AI 위임 작업 「완료」 보기 — 이슈별 종료 작업 조회(완료 판정·최근 종료 시각 정렬·대표 종료 작업 DISTINCT ON).
-- 기존 인덱스는 모두 진행 중(ended_at IS NULL) 부분 인덱스라 종료 행을 이슈로 찾을 길이 없었다. 종료 행은 지우지 않아 계속 쌓인다.
-- 순서(issue_id, ended_at DESC, id DESC)는 대표 종료 작업 선택의 ORDER BY 와 같다. 추가만 하므로 구 버전과 공존해도 안전하다.
CREATE INDEX agent_work_issue_ended_idx ON agent_work(issue_id, ended_at DESC, id DESC) WHERE ended_at IS NOT NULL;

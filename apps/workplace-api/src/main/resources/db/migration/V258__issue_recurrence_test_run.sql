-- V258 (WP-1313): 반복 AI 작업을 다음 회차를 기다리지 않고 「지금 실행」(테스트 실행)한다.
--
-- 테스트 실행은 정기 회차와 따로 결과를 받는다 — 정기 회차의 결과 대기(pending_run_id)·연속 실패 수·다음 회차(next_run_at)를 건드리지 않는다.
-- 테스트 실행은 되돌릴 수 없는 쓰기(메일 보내기·일정 만들기 등) 직전에 멈추고 이슈 챗에 묻는다. 그 질문은 WP-1312 의 「답을 기다리는 질문」
-- 열을 그대로 쓰되, 누가 답할 수 있는지와 멈춘 쓰기 목록을 함께 남겨, 답을 받은 이어 처리가 그 쓰기만 실행하게 한다.
--
-- - test_run_id: 보낸 테스트 실행의 실행 id("<issueId>-t<보낸 시각 ms>"). 결과 보고가 이 값과 같으면 테스트 결과로 받는다
-- - test_run_dispatched_at: 테스트 실행을 보낸 시각 — 30분이 지나도록 결과가 없으면 스케줄러가 비우고 알린다
-- - test_run_requested_by: 「지금 실행」을 누른 사람 — 테스트 실행이 남긴 질문에 답할 사람이다
-- - pending_question_answerer: 답을 기다리는 질문에 답할 수 있는 사람. 값이 있으면 테스트 실행(또는 그 이어 처리)이 남긴 질문이고,
--   없으면 정기 회차의 질문이라 지금처럼 반복을 저장한 사람(created_by)이 답한다
-- - pending_question_actions: 테스트 실행이 멈춘 되돌릴 수 없는 쓰기 목록(JSON 배열 [{tool, args}]) — 답을 받은 이어 처리가 이 쓰기만 실행한다
-- - follow_up_test_by: 지금 도는 이어 처리가 테스트 질문의 답으로 보낸 것이면 답한 사람(아니면 null) — 결과 글에 테스트 표시를 붙이고,
--   이어 처리가 또 물으면 같은 사람이 답하게 한다
--
-- 모두 nullable 열 추가라 구 코드가 새 스키마에서 그대로 동작한다(롤링 배포 호환 — 구 코드는 이 열을 모르고 쓰지 않는다).
ALTER TABLE issue_recurrence
  ADD COLUMN test_run_id               VARCHAR(64),
  ADD COLUMN test_run_dispatched_at    TIMESTAMPTZ,
  ADD COLUMN test_run_requested_by     BIGINT,
  ADD COLUMN pending_question_answerer BIGINT,
  ADD COLUMN pending_question_actions  TEXT,
  ADD COLUMN follow_up_test_by         BIGINT;

-- 결과를 오래 못 받은 테스트 실행을 찾는다(30분 넘게 대기 중인 테스트 실행).
CREATE INDEX idx_issue_recurrence_test_run ON issue_recurrence(test_run_dispatched_at) WHERE test_run_id IS NOT NULL;

-- V255 (WP-1312): 반복 회차가 남긴 질문에 사람이 답하면 같은 AI 가 이어 처리한다.
--
-- 반복 회차(V232, WP-989)가 이슈 설명이 시킨 확인을 받으려고 이슈 챗에 질문 글을 남기면(WP-1311), 지금까지는 사람이 답해도 아무 일이 없었다.
-- 반복 행에 「답을 기다리는 질문」과 「답을 받아 보낸 이어 처리」를 남겨, 반복을 저장한 사람이 멘션 없이 답해도 그 회차와 같은 신원·권한으로 이어 한다.
--
-- - pending_question_message_id: 답을 기다리는 질문 글(chat_message.id). 반복당 하나 — 새 질문이 오면 예전 질문을 바꾼다.
--   chat 모듈 테이블이라 FK 는 걸지 않는다(질문 글이 지워져도 반복 행은 그대로 — 답 판정은 이 id 보다 뒤 글인지만 본다)
-- - pending_question_text: 그 질문 본문(이슈 챗에 남긴 그대로) — 이어 처리 지시문에 「이 질문에 대한 답」으로 싣는다
-- - pending_question_asked_at: 질문을 남긴 시각 — 7일이 지나면 답으로 보지 않는다(만료)
-- - follow_up_run_id: 답을 받아 보낸 이어 처리의 실행 id("<issueId>-f<답 글 id>"). 결과 보고는 정기 회차 id 와 이 값 중 하나와 같을 때 반영한다
-- - follow_up_dispatched_at: 이어 처리를 보낸 시각 — 30분이 지나도록 결과가 없으면 스케줄러가 비우고 알린다
--
-- 모두 nullable 열 추가라 구 코드가 새 스키마에서 그대로 동작한다(롤링 배포 호환 — 구 코드는 이 열을 모르고 쓰지 않는다).
ALTER TABLE issue_recurrence
  ADD COLUMN pending_question_message_id BIGINT,
  ADD COLUMN pending_question_text       TEXT,
  ADD COLUMN pending_question_asked_at   TIMESTAMPTZ,
  ADD COLUMN follow_up_run_id            VARCHAR(64),
  ADD COLUMN follow_up_dispatched_at     TIMESTAMPTZ;

-- 결과를 오래 못 받은 이어 처리를 찾는다(30분 넘게 대기 중인 이어 처리).
CREATE INDEX idx_issue_recurrence_follow_up ON issue_recurrence(follow_up_dispatched_at) WHERE follow_up_run_id IS NOT NULL;

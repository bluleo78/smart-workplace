-- WP-1024: 대기 중(WAITING) 진행 상태 — AI 몫을 마치고 다른 사람·AI 의 차례(PR 리뷰·수정, 다른 AI 의 답 등)를 기다린다.
-- 진행(ended_at IS NULL) 상태가 9종이 되므로 V186 이 만든 상태 CHECK 3개를 다시 만든다. 이름이 틀리면 실패하도록 IF EXISTS 를 쓰지 않는다.
-- 롤링 배포: 옛 코드는 WAITING 을 쓰지 않으므로 넓힌 CHECK 와 함께 돌아도 문제없다. 되돌릴 때는 WAITING 행이 없어야 한다.
ALTER TABLE agent_work DROP CONSTRAINT agent_work_state_check;
ALTER TABLE agent_work DROP CONSTRAINT agent_work_ended_state_check;
ALTER TABLE agent_work_event DROP CONSTRAINT agent_work_event_state_check;

ALTER TABLE agent_work ADD CONSTRAINT agent_work_state_check
  CHECK (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','WAITING','SCHEDULED','PAUSED',
                   'COMPLETED','FAILED','CANCELED','REJECTED'));
ALTER TABLE agent_work ADD CONSTRAINT agent_work_ended_state_check
  CHECK ((ended_at IS NULL) = (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','WAITING','SCHEDULED','PAUSED')));
ALTER TABLE agent_work_event ADD CONSTRAINT agent_work_event_state_check
  CHECK (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','WAITING','SCHEDULED','PAUSED',
                   'COMPLETED','FAILED','CANCELED','REJECTED'));

-- WP-450: 다음 회차 대기(SCHEDULED) 진행 상태와 다음 실행 시각(next_run_at).
-- AI 가 스스로 양보하고 정한 시각 이후에 이어 가는 진행 상태다. 진행(ended_at IS NULL) 상태가 8종이 되므로 상태 CHECK 3개를 다시 만든다.
-- 기존 이름(V170 이 Flyway 로 올린 DB 의 pg_constraint 기준): agent_work_state_check · agent_work_check2(ended_at ↔ 진행 상태) ·
-- agent_work_event_state_check. 이름이 틀리면 마이그레이션이 실패하도록 IF EXISTS 를 쓰지 않는다.
ALTER TABLE agent_work DROP CONSTRAINT agent_work_state_check;
ALTER TABLE agent_work DROP CONSTRAINT agent_work_check2;
ALTER TABLE agent_work_event DROP CONSTRAINT agent_work_event_state_check;

ALTER TABLE agent_work ADD CONSTRAINT agent_work_state_check
  CHECK (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','SCHEDULED','PAUSED',
                   'COMPLETED','FAILED','CANCELED','REJECTED'));
-- 진행 상태 ⇔ ended_at NULL. 새 이름에 state 를 넣어 두면 테스트의 상태 CHECK 해제 도우미(정의에 state 가 든 CHECK 를 찾는다)가 그대로 동작한다.
ALTER TABLE agent_work ADD CONSTRAINT agent_work_ended_state_check
  CHECK ((ended_at IS NULL) = (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','SCHEDULED','PAUSED')));
ALTER TABLE agent_work_event ADD CONSTRAINT agent_work_event_state_check
  CHECK (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','SCHEDULED','PAUSED',
                   'COMPLETED','FAILED','CANCELED','REJECTED'));

-- 다음 실행 시각 — SCHEDULED 일 때만 의미가 있고 선택값이다(없으면 「시각 미정」). 과거 시각도 허용(= 지금 할 차례).
-- state 와 묶는 CHECK 는 두지 않는다: 롤링 배포 중 옛 코드가 상태만 바꿔도 깨지지 않게, 비우기는 애플리케이션이 맡는다.
ALTER TABLE agent_work ADD COLUMN next_run_at TIMESTAMPTZ;

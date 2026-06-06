-- 반복 일정(#111): 마스터 일정에 RRULE 저장 + 회차별 예외(취소/override) 관리.
-- recurrence_rule 은 RFC 5545 RRULE 문자열(null = 단일 일정).
-- 예외 테이블은 특정 회차(occurrence_date)를 취소하거나 별도 일정으로 override 할 때 사용.
ALTER TABLE calendar_event ADD COLUMN recurrence_rule VARCHAR(500);

CREATE TABLE calendar_event_exception (
  id                BIGSERIAL   PRIMARY KEY,
  event_id          BIGINT      NOT NULL REFERENCES calendar_event(id) ON DELETE CASCADE,
  occurrence_date   TIMESTAMPTZ NOT NULL,                 -- 예외 대상 회차의 원래 시작 시각
  is_cancelled      BOOLEAN     NOT NULL DEFAULT FALSE,    -- true = 해당 회차 취소
  override_event_id BIGINT      REFERENCES calendar_event(id) ON DELETE CASCADE,  -- 회차를 대체하는 별도 일정
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendar_event_exception_uq UNIQUE (event_id, occurrence_date)       -- 회차당 예외 1건
);
-- 마스터 일정 기준 예외 조회용
CREATE INDEX idx_calendar_event_exception_event ON calendar_event_exception (event_id);

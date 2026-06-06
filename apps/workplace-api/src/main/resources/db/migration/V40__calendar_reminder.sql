-- 캘린더 리마인더(#110): 일정 시작 N분 전 알림을 notify 인박스로 발화.
-- 이벤트당 리마인더 1건(UNIQUE). lead_minutes 분 전, fired_at 으로 중복 발화 방지.
CREATE TABLE event_reminder (
  id            BIGSERIAL PRIMARY KEY,
  event_id      BIGINT NOT NULL UNIQUE REFERENCES calendar_event(id) ON DELETE CASCADE,
  lead_minutes  INT    NOT NULL,                 -- 시작 N분 전
  fired_at      TIMESTAMPTZ                       -- null = 미발화. 발화 시각 기록(중복 발화 방지)
);
-- 매분 폴링: 미발화 리마인더만 스캔(부분 인덱스)
CREATE INDEX idx_event_reminder_unfired ON event_reminder(event_id) WHERE fired_at IS NULL;

-- notification 일반화: 이슈 전용 → 이슈/캘린더 등 다중 주제 수용.
-- 기존 이슈 알림은 issue_id 유지, 리마인더 알림은 event_id 사용(issue_id null).
ALTER TABLE notification ALTER COLUMN issue_id DROP NOT NULL;
ALTER TABLE notification ADD COLUMN event_id BIGINT REFERENCES calendar_event(id) ON DELETE CASCADE;

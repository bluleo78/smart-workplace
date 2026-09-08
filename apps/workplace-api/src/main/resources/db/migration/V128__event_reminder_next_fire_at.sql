-- 반복 일정 리마인더 회차 재무장(#705): event_reminder 는 이벤트당 1건 + fired_at 단일 컬럼이라
-- 마스터의 최초 회차만 발화하고 이후 회차는 fired_at 이 이미 채워져 영구히 스킵된다.
-- cron 의 next_run_at 패턴을 적용 — 애플리케이션이 "다음 발화 시각"을 미리 계산해 저장하고,
-- 발화할 때마다 다음 회차로 재무장한다. findDue() 는 next_fire_at 만 비교하면 되므로 단순해진다.
ALTER TABLE event_reminder ADD COLUMN next_fire_at TIMESTAMPTZ;

-- 백필: 단발 일정은 이미 발화됐으면(fired_at IS NOT NULL) NULL, 아니면 starts_at - lead_minutes.
-- 반복 일정(recurrence_rule IS NOT NULL)의 정확한 "다음 미발화 회차"는 RRULE 전개가 필요해 SQL로
-- 계산할 수 없으므로 우선 starts_at - lead_minutes 로 채운다 — 스케줄러 기동 직후 첫 poll 에서
-- CalendarEventService 재계산 경로를 타지 않은 기존 반복 리마인더는 이 백필값 기준으로 due 판정되고,
-- 발화 시 markFired 재무장 로직이 이후 회차부터는 정확히 RRULE 기준으로 교정한다.
UPDATE event_reminder er
SET next_fire_at = CASE
  WHEN er.fired_at IS NOT NULL AND ce.recurrence_rule IS NULL THEN NULL
  ELSE ce.starts_at - make_interval(mins => er.lead_minutes)
END
FROM calendar_event ce
WHERE ce.id = er.event_id;

-- 기존 부분 인덱스(fired_at IS NULL 기준)는 더 이상 findDue() 쿼리 패턴과 맞지 않으므로 교체.
DROP INDEX IF EXISTS idx_event_reminder_unfired;
CREATE INDEX idx_event_reminder_due ON event_reminder(next_fire_at) WHERE next_fire_at IS NOT NULL;

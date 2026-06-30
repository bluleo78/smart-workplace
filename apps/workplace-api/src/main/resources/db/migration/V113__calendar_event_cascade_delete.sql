-- V113: calendar_event.calendar_id FK 를 ON DELETE CASCADE 로 교체.
-- 사유: 계정 하드삭제 시 calendar cascade 삭제가 일정에서 막히던(NO ACTION) 문제 해소 +
--       기존 외부 캘린더 reconcile 삭제 경로도 정상화. 일반 캘린더 삭제는 일정을 먼저 이동하므로 영향 없음.
ALTER TABLE calendar_event DROP CONSTRAINT calendar_event_calendar_id_fkey;
ALTER TABLE calendar_event
    ADD CONSTRAINT calendar_event_calendar_id_fkey
    FOREIGN KEY (calendar_id) REFERENCES calendar(id) ON DELETE CASCADE;

-- WP-712 일정 변경·취소 알림 — 알림에 일정 제목·시작 시각을 함께 남긴다.
-- 취소 알림은 일정 행이 이미 지워졌거나(전체 삭제) 반복의 한 회차만 취소돼 가리킬 일정이 없다(event_id NULL).
-- 그래도 인박스·푸시가 「무슨 일정이 언제였는지」를 보이도록 알림 행에 그 시점의 제목·시작 시각을 담는다.
-- 변경 알림도 바뀐 시점의 제목·새 시각을 담아, 나중에 또 바뀌어도 알림이 그때의 변경을 가리키게 한다.
-- 추가만 하는 nullable 컬럼이라 구·신 버전이 섞여 돌아도 안전하다(expand).
ALTER TABLE notification
    ADD COLUMN event_title     VARCHAR(200),
    ADD COLUMN event_starts_at TIMESTAMPTZ;

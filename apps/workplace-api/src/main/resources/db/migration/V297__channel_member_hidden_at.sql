-- V297 (WP-1676): DM 대화 숨기기 — 멤버별로 DM 을 내 목록에서 감춘 시각. 컬럼 추가만(롤링 배포 호환).
--   hidden_at: NULL = 보임. 값이 있으면 그 뒤에 새 최상위 메시지가 오기 전까지 이 멤버의 DM 목록에서 뺀다.
--     멤버별 값이라 상대의 목록에는 영향이 없고, 기록(메시지·멤버십)은 그대로 남는다. 다시 열면(createOrGet) NULL 로 지운다.
ALTER TABLE channel_member ADD COLUMN hidden_at TIMESTAMPTZ;

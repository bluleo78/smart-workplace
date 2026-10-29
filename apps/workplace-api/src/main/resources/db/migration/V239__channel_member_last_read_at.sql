-- V237 (WP-1176): DM 읽음 표시 — 멤버가 읽은 위치(last_read_message_id)를 마지막으로 앞으로 옮긴 시각.
--
-- DM 에서 상대가 내 메시지를 어디까지·언제 읽었는지 보여 주려면 읽은 위치에 더해 그 시각이 필요하다. 읽은 위치가 실제로 앞으로 갈 때만
-- 서버가 now() 로 채운다(같은 위치를 다시 읽음 처리해도 시각은 그대로). 기존 행은 언제 읽었는지 알 수 없어 NULL 로 둔다 — 화면은 시각 없이
-- 「읽음」만 보인다. 롤링 배포 호환: NULL 허용 새 열이라 구 코드의 insert·update 는 그대로 돈다(구 코드가 읽음을 올리면 시각은 갱신되지 않는다).
ALTER TABLE channel_member ADD COLUMN last_read_at TIMESTAMPTZ;

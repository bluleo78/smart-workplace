-- V304: IMAP 서버의 UIDPLUS 지원 여부 기록(WP-1682) — 휴지통 메일 완전 삭제는 UID EXPUNGE(UIDPLUS)로 고른 메일만 지워야 해서,
-- 서버가 UIDPLUS 를 지원하지 않으면 일반 EXPUNGE 가 휴지통의 다른 \Deleted 메일까지 지우므로 완전 삭제를 막는다. 화면이 그 사실을 미리 알 수
-- 있게 메일함 목록 갱신(IMAP 접속) 때마다 서버 capability 를 이 열에 적어 둔다.
--
-- 값: TRUE = 지원, FALSE = 미지원, NULL = 모름(아직 목록 갱신 전이거나 IMAP 이 아닌 공급자). NULL 이면 막지 않는다 — 실제 삭제 시점에
-- 서버 capability 를 다시 확인하므로 모를 때 미리 막을 이유가 없다.
--
-- 롤링 배포 판단(expand-only): NULL 허용 새 열 추가뿐이라 옛 인스턴스의 읽기·INSERT·UPDATE 가 그대로 성공한다. 옛 인스턴스는 이 열을
-- 적지 않아 롤링 중에는 NULL 로 남고, 새 인스턴스의 다음 목록 갱신이 채운다.
ALTER TABLE email_account ADD COLUMN imap_uidplus BOOLEAN NULL;

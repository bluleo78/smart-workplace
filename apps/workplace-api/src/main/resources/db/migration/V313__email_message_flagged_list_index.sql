-- WP-1742: 별표 모아 보기(GET /mail/accounts/{id}/messages?flagged=true)가 계정의 별표 메일을 메일함과 무관하게 최신순으로 읽는 부분 인덱스.
-- 목록 정렬(received_at DESC NULLS LAST, id DESC — EmailMessageRepository.fetchSummaries)과 같은 순서라 커서 페이지가 인덱스 순서로 끝난다.
-- PostgreSQL 의 DESC 기본은 NULLS FIRST 라 정렬과 맞추려 NULLS LAST 를 명시한다.
-- V309 의 idx_email_message_flagged_imap 은 (account_id, folder_id, imap_uid) 순 — 동기화가 폴더별로 쓰는 것이라 이 목록 정렬에는 쓸 수 없다.
-- 별표 메일 수(unread-counts.flagged)도 같은 부분 인덱스로 account_id 범위만 훑는다.
-- 추가만 하므로 롤링 배포 호환. CONCURRENTLY 는 쓰지 않는다 — 이 저장소의 인덱스 마이그레이션(V268·V309 등)과 같이 일반 CREATE INDEX.
CREATE INDEX idx_email_message_flagged_list
  ON email_message (account_id, received_at DESC NULLS LAST, id DESC)
  WHERE flagged;

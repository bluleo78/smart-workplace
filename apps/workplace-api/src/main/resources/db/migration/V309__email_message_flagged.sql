-- WP-1741: 메일 별표(서버 플래그 — IMAP \Flagged, Graph flag)와 원본 서버 역동기화.
-- 롤링 배포 호환(expand): 상수 DEFAULT 컬럼·nullable 컬럼·인덱스만 추가한다(PG11+ 는 테이블을 재작성하지 않음).
-- 읽음(seen) 의 V143·V156 컬럼과 같은 모양으로 둔다 — 반영 대기·재시도 상태를 속성마다 따로 두어야
-- 한쪽(예: 읽음) 반영 실패·포기·해제가 다른 쪽(별표) 대기 표시를 건드리지 않는다.

-- 1) 별표 값 — 서버 플래그를 따른다(동기화가 서버 값으로 맞춤).
ALTER TABLE email_message ADD COLUMN flagged BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) 로컬 별표 변경 후 원본 서버 반영 대기 — true 인 동안 동기화가 flagged 를 덮어쓰지 않는다.
ALTER TABLE email_message ADD COLUMN flagged_push_pending BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) 별표 반영 재시도 백오프 — 실패 횟수와 다음 시도 시각. 사용자가 별표를 바꾸면 0 / now() 로 되돌린다.
ALTER TABLE email_message ADD COLUMN flagged_push_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE email_message ADD COLUMN flagged_push_next_at TIMESTAMPTZ;

COMMENT ON COLUMN email_message.flagged IS '별표(서버 플래그 — IMAP \Flagged, Graph flag.flagStatus=flagged) (WP-1741)';
COMMENT ON COLUMN email_message.flagged_push_pending IS '로컬 별표 변경 후 원본 서버 반영 대기 — true 인 동안 동기화가 flagged 를 덮어쓰지 않음 (WP-1741)';
COMMENT ON COLUMN email_message.flagged_push_attempts IS '별표 역동기화 연속 실패 횟수 — 상한에 닿으면 포기하고 서버 값을 따름 (WP-1741)';
COMMENT ON COLUMN email_message.flagged_push_next_at IS '별표 역동기화 다음 시도 시각(지수 백오프). NULL 이면 즉시 대상 (WP-1741)';

-- 4) 재시도 배치·디스패처가 "계정의 별표 반영 대기 행"을 찾는 부분 인덱스(읽음 idx_email_message_seen_push_pending 과 같은 모양).
CREATE INDEX idx_email_message_flagged_push_pending
  ON email_message (account_id, id)
  WHERE flagged_push_pending;

-- 5) 동기화가 "폴더의 로컬 별표 메일"(서버 반영 대기 아님)을 UID 큰 순으로 상한까지 읽는 부분 인덱스
--    (EmailMessageRepository.listFlaggedImapStates). 별표 메일은 대개 소수라 폴더 전체를 훑지 않게 한다.
CREATE INDEX idx_email_message_flagged_imap
  ON email_message (account_id, folder_id, imap_uid DESC)
  WHERE flagged AND NOT flagged_push_pending AND imap_uid IS NOT NULL;

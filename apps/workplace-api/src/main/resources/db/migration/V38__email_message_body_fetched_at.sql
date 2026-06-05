-- 본문 적재 상태 추적. NULL = 본문 아직 미적재(목록만 동기화됨).
-- 백그라운드/OnDemand 보충 대상 선정과 "빈 메일 vs 미적재" 구분에 사용.
ALTER TABLE email_message ADD COLUMN body_fetched_at TIMESTAMPTZ NULL;

-- 백그라운드 보충 대상 조회(account 별 미적재 최근순) 가속.
CREATE INDEX idx_email_message_body_pending
  ON email_message (account_id, received_at DESC)
  WHERE body_fetched_at IS NULL AND imap_uid IS NOT NULL;

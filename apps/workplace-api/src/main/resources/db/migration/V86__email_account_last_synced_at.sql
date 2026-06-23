-- 메일 계정의 마지막 성공 동기화 시각. 자동·수동 동기화 모두 이 컬럼을 갱신한다.
ALTER TABLE email_account ADD COLUMN last_synced_at TIMESTAMPTZ;

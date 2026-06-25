-- Graph 첨부의 안정 식별자를 저장해 ordinal(목록 위치) 의존 없이 직접 조회할 수 있도록 한다.
-- IMAP 첨부는 이 컬럼이 NULL(무영향).
ALTER TABLE email_attachment
    ADD COLUMN provider_attachment_id TEXT;

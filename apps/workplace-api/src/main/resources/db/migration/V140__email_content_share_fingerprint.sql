-- WP-130: 메일 content 공유 게이트를 Message-ID 단독 → Message-ID + 공유 지문(fingerprint)으로 강화한다.
--
-- 배경: Message-ID 는 발신자가 임의로 정할 수 있는 헤더다. (tenant_id, message_id) 만으로 content 를 공유하면
--   같은 테넌트 사용자가 다른 사람 메일의 Message-ID 를 단 위조 메일을 받아 그 사람의 본문·첨부를 열람·변조할 수 있다.
--
-- fingerprint = sha256(공급자 종류 · 발신자 · Date(초) · 제목 · [IMAP] BODYSTRUCTURE 요약). 동기화 시점(본문 다운로드 전)에
--   애플리케이션이 계산한다(MailContentHash.fingerprint). 공급자 종류가 다르면(IMAP/Graph/보낸편지함) 서로 공유하지 않는다.
--
-- 기존 행은 fingerprint 를 NULL 로 둔다(SQL 에서 BODYSTRUCTURE 를 재현할 수 없음). 유니크 인덱스에서 NULL 은 서로 다르므로
--   신규 수신은 기존 행과 공유되지 않는다 — 안전 측(fail-closed). 이미 잘못 공유된 행 정리는 WP-131.
ALTER TABLE email_content ADD COLUMN fingerprint VARCHAR(64);

-- 기존 (tenant_id, message_id) 유니크는 같은 Message-ID·다른 지문의 content 생성을 막으므로 교체한다.
DROP INDEX IF EXISTS email_content_tenant_message_uk;
CREATE UNIQUE INDEX email_content_tenant_message_fp_uk
    ON email_content (tenant_id, message_id, fingerprint)
    WHERE message_id IS NOT NULL AND fingerprint IS NOT NULL;

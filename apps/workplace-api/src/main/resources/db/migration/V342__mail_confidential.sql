-- WP-2029: 메일을 「기밀」로 보낸다. 제목 머리말 「[기밀]」 + Sensitivity: Company-Confidential 헤더로 나가고,
-- 보낸 사본(email_content)과 임시저장(mail_draft)이 기밀 여부를 기억해 다시 열어도 유지한다.
ALTER TABLE email_content ADD COLUMN IF NOT EXISTS confidential boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN email_content.confidential IS 'WP-2029: 기밀로 보낸 메일 여부(보낸 사본에만 기록 — 받은 메일 헤더 판정은 범위 밖)';
ALTER TABLE mail_draft ADD COLUMN IF NOT EXISTS confidential boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN mail_draft.confidential IS 'WP-2029: 임시저장 시점의 기밀 발송 선택';

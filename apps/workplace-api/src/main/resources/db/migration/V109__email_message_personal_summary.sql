-- 개인 비서(T2) 맞춤 요약 — envelope(사람) 단위. 공유 email_content.ai_summary(공통비서/객관적)와 분리.
-- 같은 메일을 여러 계정이 받아도 개인 요약은 계정별로 다를 수 있으므로 message(envelope)에 둔다.
ALTER TABLE email_message
    ADD COLUMN ai_personal_summary       TEXT,
    ADD COLUMN ai_personal_summarized_at TIMESTAMPTZ;

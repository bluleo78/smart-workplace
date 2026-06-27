-- 메일 콘텐츠(공유) 테이블. 테넌트 내 message_id 단위로 메일 본문·헤더를 1벌만 보관한다.
-- 수신자별 상태(seen 등)는 email_message(envelope)에 남고, 본문은 여기로 일원화한다.
CREATE TABLE email_content (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenant(id),
    -- RFC Message-ID. 테넌트 내 dedup 키. NULL이면 공유 불가(행마다 고유 content).
    message_id    VARCHAR(998),
    -- 본문 sha256(정규화). lazy 본문 적재 시 채움. 무결성·검색·향후 병합용.
    content_hash  VARCHAR(64),
    subject         VARCHAR(998),
    body_text       TEXT,
    body_html       TEXT,
    snippet         VARCHAR(280),
    in_reply_to     VARCHAR(998),
    mail_references TEXT,
    thread_id       VARCHAR(998) NOT NULL,
    body_fetched_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 테넌트 내 동일 message_id는 동일 콘텐츠 1행(§4). NULL은 공유 제외.
CREATE UNIQUE INDEX email_content_tenant_message_uk
    ON email_content (tenant_id, message_id)
    WHERE message_id IS NOT NULL;
-- 해시 조회/병합용.
CREATE INDEX email_content_tenant_hash_idx
    ON email_content (tenant_id, content_hash);

-- RLS: 테넌트 격리(fail-closed). 소유자도 강제(FORCE).
ALTER TABLE email_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_content FORCE ROW LEVEL SECURITY;
CREATE POLICY email_content_tenant_isolation ON email_content
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- envelope → content 참조. 명시적 GC를 위해 RESTRICT(cascade 금지).
ALTER TABLE email_message
    ADD COLUMN content_id BIGINT REFERENCES email_content(id) ON DELETE RESTRICT;
CREATE INDEX email_message_content_id_idx ON email_message (content_id);

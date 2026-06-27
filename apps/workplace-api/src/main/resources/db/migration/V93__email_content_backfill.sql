-- 기존 email_message 를 (tenant_id, message_id) 로 묶어 content 로 추출한다.
-- 테넌트 경계 절대 병합 금지(§8): 그룹키에 tenant_id 포함.
-- 본문 해시는 pgcrypto 가용 시 계산, 아니면 NULL(추후 lazy 적재 시 채움 — 해시는 공유 게이트 아님).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) message_id 있는 그룹: 그룹당 content 1개. canonical = 본문 보유 우선, 없으면 min(id).
WITH grouped AS (
    SELECT tenant_id, message_id,
           (ARRAY_AGG(id ORDER BY (body_text IS NOT NULL OR body_html IS NOT NULL) DESC, id))[1] AS canonical_id
    FROM email_message
    WHERE message_id IS NOT NULL
    GROUP BY tenant_id, message_id
),
ins AS (
    INSERT INTO email_content
        (tenant_id, message_id, content_hash, subject, body_text, body_html, snippet,
         in_reply_to, mail_references, thread_id, body_fetched_at, created_at)
    SELECT m.tenant_id, m.message_id,
           CASE WHEN m.body_text IS NOT NULL OR m.body_html IS NOT NULL
                THEN encode(digest(coalesce(m.body_text,'') || E'\\000' || coalesce(m.body_html,''), 'sha256'), 'hex')
                ELSE NULL END,
           m.subject, m.body_text, m.body_html, m.snippet,
           m.in_reply_to, m.mail_references, m.thread_id, m.body_fetched_at, m.created_at
    FROM grouped g
    JOIN email_message m ON m.id = g.canonical_id
    RETURNING id, tenant_id, message_id
)
UPDATE email_message em
SET content_id = ins.id
FROM ins
WHERE em.tenant_id = ins.tenant_id AND em.message_id = ins.message_id;

-- 2) message_id NULL 행: 각자 content 1개(공유 없음).
DO $$
DECLARE r RECORD;
DECLARE new_id BIGINT;
BEGIN
  FOR r IN SELECT * FROM email_message WHERE message_id IS NULL AND content_id IS NULL LOOP
    INSERT INTO email_content
        (tenant_id, message_id, content_hash, subject, body_text, body_html, snippet,
         in_reply_to, mail_references, thread_id, body_fetched_at, created_at)
    VALUES
        (r.tenant_id, NULL,
         CASE WHEN r.body_text IS NOT NULL OR r.body_html IS NOT NULL
              THEN encode(digest(coalesce(r.body_text,'') || E'\\000' || coalesce(r.body_html,''), 'sha256'), 'hex')
              ELSE NULL END,
         r.subject, r.body_text, r.body_html, r.snippet,
         r.in_reply_to, r.mail_references, r.thread_id, r.body_fetched_at, r.created_at)
    RETURNING id INTO new_id;
    UPDATE email_message SET content_id = new_id WHERE id = r.id;
  END LOOP;
END $$;

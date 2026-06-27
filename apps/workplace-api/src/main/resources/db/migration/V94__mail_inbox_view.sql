-- §3 접근 불변식 — envelope-first 표면(mail_inbox 뷰).
-- email_content 는 반드시 email_message 소유 조인을 통해서만 접근해야 한다.
-- RLS는 기반 테이블(email_message·email_content) FORCE RLS에서 강제되므로
-- 이 뷰를 통한 조회도 동일한 격리를 자동 상속한다.
-- 소비 쿼리에서 account_id 필터를 추가해 사용자별 소유 검증을 수행한다.
CREATE VIEW mail_inbox AS
SELECT m.id,
       m.account_id,
       m.folder_id,
       m.tenant_id,
       m.seen,
       m.message_id,
       c.subject,
       c.snippet,
       c.body_text,
       c.body_html,
       c.thread_id
FROM email_message m
         JOIN email_content c ON c.id = m.content_id;

COMMENT ON VIEW mail_inbox IS
    'envelope-first 메일 받은편지함 뷰: email_content 직접 조회 금지 표면. '
    'account 소유 필터는 소비 쿼리에서 account_id 조건으로 추가한다.';

-- WP-131: V140 이전에 Message-ID 만으로 잘못 공유됐을 수 있는 envelope 를 미검증 상태로 되돌려 본문을 다시 받게 한다.
--
-- 배경: V140 이전에는 (tenant_id, message_id) 가 같으면 content 1벌을 공유했다. 운영 감사에서 같은 Message-ID·같은 발신자인데
--   발신 시각이나 수신자(To/CC)가 다른 공유 그룹이 나왔다 — 발신 시스템이 같은 ID 로 수신자마다 따로 보낸 메일이라,
--   첫 적재자의 본문·첨부가 다른 수신자에게 보였을 수 있다. 저장된 본문이 1벌뿐이라 SQL 로는 실제로 달랐는지 알 수 없다.
--
-- 처리: 의심 그룹의 envelope 는 fetched_at 을 비워 미검증으로 되돌린다. 미검증 동안 공유 본문 유래 값은 노출되지 않고
--   (EmailMessageRepository.verified), 다음에 열 때 각자 자기 사본을 받아 공유 게이트(MailContentShareGate)가 본문·첨부를 비교한다.
--   같으면 공유를 유지하고, 다르면 그 envelope 만 분리한다 — 미리 쪼개지 않으므로 실제로 다른 메일만 분리된다.
--   - 첨부 행은 첫 적재자 manifest 를 가리키므로 지운다(재적재 시 자기 첨부 목록으로 교체 삽입).
--   - 개인 AI 요약은 남의 본문으로 만들어졌을 수 있으므로 지운다.
--   - 저장된 본문의 주인 envelope 1개는 그대로 둔다. V140 이전 updateBody 는 무조건 덮어썼으므로 본문은 마지막 적재자의 것이고,
--     그 envelope 의 fetched_at 이 content.body_fetched_at 과 가장 가깝다. 주인까지 되돌리면 서버에서 이미 지워지거나 옮겨진
--     메일은 다시 받을 수 없어, 맞는 본문을 영구히 잃거나(IMAP 분리) 계속 숨겨진다(Graph 재시도 실패).
--
-- 헤더 비교는 재검증 범위를 줄이는 필터일 뿐 보안 경계가 아니다. 발신자·Date·To/CC 까지 똑같이 맞춘 위조(예: BCC 수신)는
--   걸러지지 않고 공유가 유지된다. 운영 감사(WP-131) 기준 의심 그룹 28개만 재검증하고 나머지 1,311개는 정상 공유로 둔다.
--
-- 대상 한정: fingerprint 가 NULL(V140 이전 공유분)이고 이미 검증 표시된 envelope 만. 원본을 다시 받을 수 없는 로컬 보낸메일
--   (imap_uid·provider_message_id 모두 NULL)은 제외한다. 재실행하면 주인만 남은 그룹이라 아무것도 바뀌지 않는다.
--
-- RLS: email_message·email_content·email_attachment 는 FORCE RLS 지만 Flyway 소유자 app 은 superuser 라 전 테넌트에 적용된다.
--   테넌트 경계는 content 가 tenant 별이라 그룹이 테넌트를 넘지 않는다.
WITH suspect AS (
    SELECT c.id AS content_id, c.body_fetched_at
    FROM email_message m
    JOIN email_content c ON c.id = m.content_id
    WHERE c.fingerprint IS NULL
    GROUP BY c.id
    HAVING count(*) > 1
       -- NULL 도 하나의 값으로 비교한다(count DISTINCT 는 NULL 을 무시).
       AND (count(DISTINCT coalesce(lower(m.from_address), '')) > 1
            OR count(DISTINCT coalesce(date_trunc('second', m.sent_at), '-infinity'::timestamptz)) > 1
            OR count(DISTINCT coalesce(m.to_addresses, '')) > 1
            OR count(DISTINCT coalesce(m.cc_addresses, '')) > 1)
),
ranked AS (
    SELECT m.id, m.imap_uid, m.provider_message_id,
           row_number() OVER (
               PARTITION BY m.content_id
               ORDER BY abs(extract(epoch FROM m.fetched_at - s.body_fetched_at)) NULLS LAST, m.id
           ) AS rn
    FROM email_message m
    JOIN suspect s ON s.content_id = m.content_id
    WHERE m.fetched_at IS NOT NULL
),
target AS (
    SELECT id
    FROM ranked
    WHERE rn > 1 -- 저장 본문의 주인(rn = 1)은 유지
      AND (imap_uid IS NOT NULL OR provider_message_id IS NOT NULL)
),
detached AS (
    DELETE FROM email_attachment a
    USING target t
    WHERE a.message_id = t.id
)
UPDATE email_message m
SET fetched_at = NULL,
    ai_personal_summary = NULL,
    ai_personal_summarized_at = NULL
FROM target t
WHERE m.id = t.id;

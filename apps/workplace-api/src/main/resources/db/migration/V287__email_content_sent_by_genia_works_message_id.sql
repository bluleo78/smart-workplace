-- WP-1364 후속: Exchange Online 은 Graph 로 보낸 MIME 을 다시 만들며 X-Mailer 를 지운다 — 받은 사본에서 헤더로 판정이 안 됐다.
-- 그래서 받은 사본은 같은 테넌트에서 우리 앱이 보낸 사본(보낼 때 저장한 전용 content: sent_by_genia_works=true·fingerprint NULL)과
-- Message-ID·보낸 사람 주소로 맞대 판정한다(EmailContentRepository.matchesOwnSent 와 같은 조건).
-- 보낸 사본은 꺾쇠 없이, 동기화 사본은 꺾쇠를 붙여 저장해 btrim 으로 비교한다.
-- RLS: email_content 는 FORCE RLS 지만 Flyway 소유자는 superuser(BYPASSRLS)라 전 테넌트에 적용된다(V136·V141·V266 선례).
-- 운영 실측(11-12): 원본 약 5만 건, 되돌려 채우기 대상 11건, 인덱스 없이도 조회 0.2초 — 잠금 시간은 짧다.

-- ① 맞대기용 부분 인덱스 — 우리 앱이 보낸 전용 content 만 담아 작다. 식은 코드의 bareMessageId 와 같아야 한다.
CREATE INDEX IF NOT EXISTS idx_email_content_genia_sent_msgid
    ON email_content (tenant_id, btrim(message_id, '<>'))
    WHERE sent_by_genia_works AND fingerprint IS NULL AND message_id IS NOT NULL;

-- ② 이미 받아 둔 사본 되돌려 채우기(false→true 만).
--    보낸 사본(수십 건)에서 출발해 받은 사본을 (tenant_id, message_id, fingerprint) 유니크 인덱스로 찾는다 — 받은 사본마다 EXISTS 를
--    돌리는 형태는 운영에서 실행 계획이 나빠 2분을 넘겼다(이 형태는 75ms). 받은 사본은 지문이 있다(findOrCreate 공유 content).
UPDATE email_content c
SET sent_by_genia_works = true
FROM (
    SELECT own.tenant_id,
           btrim(own.message_id, '<>') AS bare,
           lower(trim(own_env.from_address)) AS from_addr
    FROM email_content own
    JOIN email_message own_env ON own_env.content_id = own.id
    WHERE own.sent_by_genia_works
      AND own.fingerprint IS NULL
      AND own.message_id IS NOT NULL
) o
WHERE c.tenant_id = o.tenant_id
  AND c.message_id IN (o.bare, '<' || o.bare || '>')
  AND c.fingerprint IS NOT NULL
  AND NOT c.sent_by_genia_works
  AND EXISTS (
    SELECT 1
    FROM email_message copy_env
    WHERE copy_env.content_id = c.id
      AND lower(trim(copy_env.from_address)) = o.from_addr
  );

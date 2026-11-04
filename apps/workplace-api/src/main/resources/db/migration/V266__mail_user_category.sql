-- WP-1340 · WP-1341 · WP-1342: 메일 분류 바로잡기 — 사본별 분류 두 층 + 기존 오분류 되돌리기(expand only).
-- 빈 결과 재시도는 WP-1347(V265: ai_category_attempts·ai_category_next_attempt_at, 1h·6h·24h)의 한 규칙을 따른다 — 여기서 따로 두지 않는다.
--
-- 분류 세 층(우선순위 순): email_message.user_category(사용자가 직접 바꾼 분류, 내 사본)
--   > email_message.ai_personal_category(개인 비서가 메일 기억을 반영해 정한 분류, 내 사본)
--   > email_content.ai_category(공용 분류, 테넌트 공유 — 기존).
--   사용자 교정을 공유 원본에 쓰면 같은 메일을 받은 동료에게 새므로 사본(email_message)에 둔다.
-- 롤링 배포 호환: 새 컬럼은 모두 NULL 허용이거나 기본값이 있다 — 구 코드는 새 컬럼을 모르고 그대로 동작한다.
-- 데이터 되돌리기 검증 테스트(EmailMessageEffectiveCategoryTest)가 시드 뒤 이 파일의 UPDATE 문만 다시 실행한다 — 세미콜론은 문장 끝에만 쓴다.
ALTER TABLE email_message
    ADD COLUMN user_category varchar(20),
    ADD COLUMN ai_personal_category varchar(20);

-- 기존 데이터 되돌리기(설계 3.5) — 재분류 대상으로 되돌리기만 한다(ai_category·ai_categorized_at = NULL).
--   WP-1347 규칙대로 ai_categorized_at 을 NULL 로 되돌리면 재시도 상태도 처음(시도 횟수 0·다음 시도 시각 NULL)으로 둔다.
--   빈 결과로 끝난 원본(분류 NULL·시도 시각 있음)은 여기서 되돌리지 않는다 — V265 의 최근 14일 되돌리기 한 규칙이 맡는다.
-- 실제 재분류는 분류 일괄(MailCategoryBackfillService)이 새 입력(사내 발신·자동 발송)·결정적 보정·⑤ 재계산·화면 무효화와 함께 한다.
-- RLS: email_content·email_message 는 FORCE RLS 지만 Flyway 소유자는 superuser(BYPASSRLS)라 전 테넌트에 적용된다(V136·V141 선례).
-- 광고 표기 정규식은 MailCategoryRules.AD_SUBJECT(^\s*[(\[]\s*광고\s*[)\]])와 같다 — 대괄호 안 이스케이프 차이를 피하려 [([] · [])] 로 쓴다.

-- ① (광고) 제목인데 분류가 업무·개인인 원본(광고 표기는 정보통신망법상 객관 신호 — 프로모션 또는 뉴스레터가 기대값).
--    분류가 NULL 인 광고 원본은 빈 결과와 같아 V265(WP-1347)의 되돌리기·재시도를 따른다(재시도 때 보정이 프로모션으로 채운다).
UPDATE email_content
SET ai_category = NULL, ai_categorized_at = NULL, ai_category_attempts = 0, ai_category_next_attempt_at = NULL
WHERE subject ~ '^\s*[([]\s*광고\s*[])]'
  AND ai_category IN ('업무', '개인');

-- ② 사내 구성원이 보낸 원본 중 뉴스레터·프로모션(광고 제목은 광고 규칙이 먼저라 제외).
--    사내 구성원 기준은 MailPeopleRepository.findMemberAddresses 와 같다 — 같은 테넌트의 ACTIVE 멤버십 · HUMAN · is_active 인
--    사용자의 user.email 또는 그 사람의 이 테넌트 메일 계정 주소(소문자·trim 비교). 도메인으로 추정하지 않는다.
--    구성원 주소는 CTE 로 한 번 모으고 (tenant_id, 주소) 로 EXISTS 비교한다 — 원본마다 구성원 서브쿼리를 다시 돌리지 않게(WP-1346).
WITH members AS (
    SELECT ms.tenant_id, lower(trim(u.email)) AS address
    FROM "user" u
    JOIN membership ms ON ms.user_id = u.id
    WHERE ms.status = 'ACTIVE'
      AND u.kind = 'HUMAN'
      AND u.is_active
    UNION
    SELECT a.tenant_id, lower(trim(a.email_address)) AS address
    FROM email_account a
    JOIN "user" u ON u.id = a.user_id
    JOIN membership ms ON ms.user_id = u.id AND ms.tenant_id = a.tenant_id
    WHERE ms.status = 'ACTIVE'
      AND u.kind = 'HUMAN'
      AND u.is_active
)
UPDATE email_content c
SET ai_category = NULL, ai_categorized_at = NULL, ai_category_attempts = 0, ai_category_next_attempt_at = NULL
WHERE c.ai_category IN ('뉴스레터', '프로모션')
  AND c.subject !~ '^\s*[([]\s*광고\s*[])]'
  AND EXISTS (
      SELECT 1
      FROM email_message m
      JOIN members mb
        ON mb.tenant_id = c.tenant_id
       AND mb.address = lower(trim(m.from_address))
      WHERE m.content_id = c.id);

-- WP-1179: 메일 계정 주소 유일성을 대소문자 무시로 DB 에서 지킨다.
-- 메일 주소는 대소문자를 가리지 않는다(ADMIN@X 와 admin@x 는 같은 메일함). 앱 검사(WP-1111)는 lower 로 비교하지만
-- 기존 인덱스 uq_email_account_user_addr 는 그대로 비교해, 검사와 INSERT 사이에 대소문자만 다른 주소가 동시에 들어오면 둘 다 저장됐다.
--
-- 운영 데이터에 대소문자만 다른 활성 중복이 없음을 확인한 뒤 적용한다(WP-1179 이슈 챗 — 중복이 있으면 이 인덱스 생성이 실패한다).
--
-- 롤링 배포 호환(expand): 옛 인덱스는 이번에 지우지 않는다 — 옛 버전의 upsertGraphAccount 가 ON CONFLICT (tenant_id, user_id,
-- email_address) 로 옛 인덱스를 고르므로, 지우면 공존하는 옛 파드의 M365 연결이 실패한다. 새 인덱스가 옛 인덱스를 포함하므로
-- (같은 주소면 lower 도 같다) 다음 배포에서 옛 인덱스를 지운다.
-- 중복이 남은 DB(개발·스테이징 등)에서는 인덱스 오류 대신 할 일을 알리고 멈춘다 — 데이터를 지우거나 합치지 않는다(메일 데이터 손실 위험).
DO $$
DECLARE dup int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT 1 FROM email_account WHERE disabled_at IS NULL
    GROUP BY tenant_id, user_id, lower(email_address) HAVING count(*) > 1) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'WP-1179: 대소문자만 다른 활성 메일 계정 중복 %건 — 사용자가 하나를 지운 뒤 다시 배포하세요', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX uq_email_account_user_addr_ci
  ON email_account (tenant_id, user_id, lower(email_address)) WHERE disabled_at IS NULL;

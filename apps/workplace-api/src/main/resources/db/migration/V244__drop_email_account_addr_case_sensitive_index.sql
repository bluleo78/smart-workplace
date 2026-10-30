-- WP-1215: V243(WP-1179)에서 남겨 둔 옛 메일 주소 유니크 인덱스(대소문자 그대로 비교)를 지운다(contract).
-- 새 인덱스 uq_email_account_user_addr_ci (tenant_id, user_id, lower(email_address)) WHERE disabled_at IS NULL 가
-- 옛 인덱스가 막던 것을 모두 막는다(주소가 같으면 lower 도 같다) — 남겨 두면 쓰기마다 인덱스를 하나 더 고치기만 한다.
--
-- 배포 순서: 옛 인덱스를 ON CONFLICT 대상으로 고르던 코드(upsertGraphAccount, v0.9.34 까지)가 운영에서 모두 내려간 뒤여야 한다.
-- 곧 WP-1179 가 든 v0.9.35 이상이 운영에 반영된 다음 릴리스에 싣는다 — v0.9.34 에서 이 마이그레이션이 든 릴리스로 바로 올리면
-- 롤링 중 공존하는 옛 파드의 M365 연결이 「ON CONFLICT 대상 인덱스 없음」으로 실패한다.
DROP INDEX IF EXISTS uq_email_account_user_addr;

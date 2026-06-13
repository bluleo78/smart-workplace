-- V56: audit_log RLS WITH CHECK 에 NULL-테넌트 INSERT 허용 추가(V55 정정).
--
-- 배경: V55 의 audit_log 정책은 표준 WITH CHECK(`tenant_id = <guc>`)만 가졌다. 그러나
--   인증/시스템 감사(로그인·가입·로그아웃)는 테넌트 선택 *전*(TenantContext=null, GUC 미설정)에
--   일어나 tenant_id=NULL 로 기록된다. 표준 WITH CHECK 에서는 `NULL = ''::bigint(NULL)` → NULL(falsy)
--   → 정책 위반으로 INSERT 가 거부된다 → 로그인 audit 실패 → 로그인 자체가 깨진다.
--   따라서 NULL insert 를 명시 허용한다.
--
-- ALTER POLICY 로 WITH CHECK 만 교체한다(USING 은 불변). NULL 행은 USING(=) 으로 여전히
--   일반 테넌트(1,2 등)에 비노출 — 운영자/BYPASSRLS 만 열람한다(설계 §4).
--   notification 정책은 NOT NULL 이라 표준 WITH CHECK 로 충분하므로 변경하지 않는다.
ALTER POLICY audit_log_tenant_isolation ON audit_log
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint OR tenant_id IS NULL);

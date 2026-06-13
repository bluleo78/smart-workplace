-- V57: audit_log RLS 정책을 IS NOT DISTINCT FROM 로 교체(V55/V56 정정, 최종형).
--
-- 배경(이 도메인의 핵심 함정):
--   AuditLogRepository.save 는 `INSERT ... RETURNING id` 를 쓴다. PostgreSQL 은 RETURNING 으로
--   되돌려읽는 행에 대해 WITH CHECK 뿐 아니라 USING(SELECT) 정책도 적용한다.
--   인증/시스템 감사(로그인·가입·로그아웃)는 테넌트 선택 전(GUC 미설정)에 tenant_id=NULL 로 insert 되는데,
--   표준 USING(`tenant_id = <guc>`)은 NULL 행에 대해 `NULL = NULL` → NULL(falsy) → RETURNING 단계에서
--   거부 → INSERT 실패 → 로그인 자체가 깨진다. (V56 의 WITH CHECK 만으로는 부족했던 이유.)
--
-- 해법: USING/WITH CHECK 둘 다 `IS NOT DISTINCT FROM` 으로 — NULL-vs-NULL 을 TRUE 로 다뤄
--   "테넌트 컨텍스트 없음(GUC='') + tenant_id NULL" 행이 자기 자신에게는 보이게(RETURNING 통과) 한다.
--   진리표 검증:
--     · GUC='' , 행 tenant_id=NULL → NULL ND NULL = TRUE  → insert+RETURNING 성공(로그인 정상)
--     · GUC=1  , 행 tenant_id=NULL → NULL ND 1   = FALSE → 일반 테넌트엔 비노출(설계 §4 유지)
--     · GUC=1  , 행 tenant_id=2    → 2 ND 1      = FALSE → 크로스테넌트 격리 유지
--     · GUC=1  , NULL insert 시도  → WITH CHECK FALSE → 거부(V56 의 `OR IS NULL` 보다 엄격)
--   → audit_log 는 RETURNING 요구 때문에 fail-closed `=` 패턴의 문서화된 예외다.
--     NULL 행은 어떤 실제 테넌트(1,2…) 컨텍스트에서도 여전히 비노출 — 운영자/BYPASSRLS 만 열람.
--   notification 정책은 NOT NULL 이라 표준 `=` 로 충분하므로 변경하지 않는다.
ALTER POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id IS NOT DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id IS NOT DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::bigint);

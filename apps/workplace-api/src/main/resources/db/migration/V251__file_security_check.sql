-- V251 (WP-1262): HTML 파일 AI 보안 점검 결과(file_security_check).
--
-- 스크립트가 든 HTML 파일을 AI 가 점검한 위험도·근거를 file 별 1행으로 둔다. 업로드 때 자동 점검(PENDING)되고, 스케줄러가
-- lease 만료 CHECKING·남은 PENDING 을 다시 줍는다(최대 3회 → FAILED). 파일이 지워지면 결과도 함께 지운다(ON DELETE CASCADE).
-- 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다). 테넌트 패턴은 V249 와 같다
-- (tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
--
-- status: PENDING / CHECKING / DONE / FAILED / SKIPPED(스크립트 없음)
-- risk:   LOW / CAUTION / HIGH (DONE 일 때만)
-- evidence: [{kind, detail}] — kind 는 EXTERNAL_REQUEST / CREDENTIAL_INPUT / OBFUSCATION / NAVIGATION / OTHER

CREATE TABLE file_security_check (
  file_id      BIGINT       PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  status       VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  risk         VARCHAR(16),
  headline     VARCHAR(300),
  evidence     JSONB,
  model        VARCHAR(64),
  attempts     INT          NOT NULL DEFAULT 0,
  leased_until TIMESTAMPTZ,
  error        VARCHAR(500),
  checked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  tenant_id    BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  CONSTRAINT fk_file_security_check_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 스케줄러 재개 수집(PENDING·lease 만료 CHECKING)만 보는 부분 인덱스 — 끝난 행(DONE/SKIPPED/FAILED)이 대부분이다.
CREATE INDEX ix_file_security_check_resume ON file_security_check(status, leased_until)
  WHERE status IN ('PENDING', 'CHECKING');

ALTER TABLE file_security_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_security_check FORCE ROW LEVEL SECURITY;
CREATE POLICY file_security_check_tenant_isolation ON file_security_check
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

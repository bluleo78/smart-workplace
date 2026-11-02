-- V256 (WP-1290): 노트 HTML 블록 AI 보안 점검 결과(wiki_html_scripts_check).
--
-- 노트(또는 HTML 문서)의 스크립트가 든 HTML 소스를 AI 가 점검한 위험도·근거를 (페이지, 소스 지문)별 1행으로 둔다.
-- 지문(source_hash) = 정렬한 소스를 구분 글자로 이은 글자의 SHA-256 — 내용이 바뀌면 새 행이 생기고, 공개 보기는 지금 내용의
-- 지문에 끝난 점검이 있을 때만 스크립트를 돌린다. 지난 지문의 행은 남는다(정리 작업 없음 — 페이지가 지워지면 함께 지운다).
-- 점검 입력(digest·truncated)을 행에 둬 스케줄러가 소스 없이 다시 점검할 수 있다. 상태 기계·판정 기준 판은 file_security_check
-- (V251·V253)와 같다. 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다). 테넌트 패턴도 V251 과 같다.
--
-- status: PENDING / CHECKING / DONE / FAILED / SKIPPED
-- risk:   LOW / CAUTION / HIGH (DONE 일 때만)
-- evidence: [{kind, detail}] — kind 는 EXTERNAL_REQUEST / CREDENTIAL_INPUT / OBFUSCATION / NAVIGATION / OTHER

CREATE TABLE wiki_html_scripts_check (
  page_id          BIGINT       NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  source_hash      CHAR(64)     NOT NULL,
  block_count      INT          NOT NULL,
  digest           TEXT         NOT NULL,
  truncated        BOOLEAN      NOT NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  risk             VARCHAR(16),
  headline         VARCHAR(300),
  evidence         JSONB,
  model            VARCHAR(64),
  attempts         INT          NOT NULL DEFAULT 0,
  leased_until     TIMESTAMPTZ,
  error            VARCHAR(500),
  checked_at       TIMESTAMPTZ,
  criteria_version SMALLINT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  tenant_id        BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  CONSTRAINT pk_wiki_html_scripts_check PRIMARY KEY (page_id, source_hash),
  CONSTRAINT fk_wiki_html_scripts_check_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 스케줄러 재개 수집(PENDING·lease 만료 CHECKING)만 보는 부분 인덱스 — 끝난 행이 대부분이다.
CREATE INDEX ix_wiki_html_scripts_check_resume ON wiki_html_scripts_check(status, leased_until)
  WHERE status IN ('PENDING', 'CHECKING');

ALTER TABLE wiki_html_scripts_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_html_scripts_check FORCE ROW LEVEL SECURITY;
CREATE POLICY wiki_html_scripts_check_tenant_isolation ON wiki_html_scripts_check
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

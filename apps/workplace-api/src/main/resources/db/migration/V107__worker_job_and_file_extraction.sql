-- 범용 비동기 잡 큐 (api 소유). task_type 으로 작업 종류 분기, 추출이 첫 타입.
CREATE TABLE worker_job (
  id           BIGSERIAL PRIMARY KEY,
  task_type    VARCHAR(32)  NOT NULL,
  params       JSONB        NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'PENDING',  -- PENDING→RUNNING→DONE|FAILED
  attempts     INT          NOT NULL DEFAULT 0,
  leased_until TIMESTAMPTZ,
  error        VARCHAR(500),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  tenant_id    BIGINT       NOT NULL REFERENCES tenant(id)
);
CREATE INDEX ix_worker_job_claim ON worker_job(status, leased_until) WHERE status = 'PENDING';

ALTER TABLE worker_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_job FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_job_tenant_isolation ON worker_job
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 추출 결과 + 콘텐츠 파이프라인 SoT. file.id 키(blob 레벨, 버전마다 별 행).
CREATE TABLE file_extraction (
  file_id        BIGINT PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  status         VARCHAR(16) NOT NULL DEFAULT 'PENDING',
                 -- PENDING→EXTRACTING→TEXT_READY→SUMMARIZING→DONE | FAILED | SKIPPED
  extracted_text TEXT,
  char_count     INT,
  truncated      BOOLEAN     NOT NULL DEFAULT false,
  lang           VARCHAR(16),
  summary        TEXT,
  summary_model  VARCHAR(64),
  attempts       INT         NOT NULL DEFAULT 0,
  leased_until   TIMESTAMPTZ,
  error          VARCHAR(500),
  extracted_at   TIMESTAMPTZ,
  summarized_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id      BIGINT      NOT NULL REFERENCES tenant(id)
);
CREATE INDEX ix_file_extraction_resume ON file_extraction(status, leased_until)
  WHERE status IN ('PENDING', 'TEXT_READY');

ALTER TABLE file_extraction ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_extraction FORCE ROW LEVEL SECURITY;
CREATE POLICY file_extraction_tenant_isolation ON file_extraction
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 드라이브 파일을 이슈/메시지에 라이브 참조로 연결하는 다형 교차링크 테이블 (#80)
CREATE TABLE drive_file_ref (
  id            BIGSERIAL PRIMARY KEY,
  drive_file_id BIGINT NOT NULL REFERENCES drive_file(id) ON DELETE CASCADE,
  source_type   VARCHAR(16) NOT NULL,   -- 'ISSUE' | 'MESSAGE'
  source_id     BIGINT NOT NULL,        -- issue.id | message.id (비-FK, 느슨한 결합)
  created_by    BIGINT NOT NULL REFERENCES "user"(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     BIGINT NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id),
  CONSTRAINT drive_file_ref_uq UNIQUE (drive_file_id, source_type, source_id)
);
CREATE INDEX idx_drive_file_ref_source ON drive_file_ref(source_type, source_id);
CREATE INDEX idx_drive_file_ref_file   ON drive_file_ref(drive_file_id);
CREATE INDEX idx_drive_file_ref_tenant ON drive_file_ref(tenant_id);

-- RLS: 테넌트 격리 (V78 신규 테이블 패턴 — ENABLE + FORCE + fail-closed 정책)
ALTER TABLE drive_file_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_file_ref FORCE ROW LEVEL SECURITY;
CREATE POLICY drive_file_ref_tenant_isolation ON drive_file_ref
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_file_ref TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE drive_file_ref_id_seq TO app_tenant;

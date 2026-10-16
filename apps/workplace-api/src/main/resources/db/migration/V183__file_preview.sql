-- WP-431: 드라이브 문서 미리보기(서버 변환 PDF) 상태. core file.id 단위 1행.
-- 변환 결과 PDF 는 원본 옆 "{storage_path}.view/preview.pdf" 에 두고, 이 테이블은 상태·시도·리스만 갖는다.
--   PENDING    : 변환 대기(실행기 거절·PDF 유실 복구로 되돌아온 상태 포함)
--   CONVERTING : 한 작업이 leased_until 까지 선점. 만료되면 다음 열람이 다시 선점한다(API 가 죽어도 영원히 202 가 아니게).
--   READY      : preview.pdf 준비됨(page_count)
--   FAILED     : failure_code + failure_transient(일시면 다음 열람 때 attempts < 상한까지 재시도, 영구면 엔진 버전이 바뀔 때만)
-- leased_until 은 선점 토큰을 겸한다 — 기록 CAS(WHERE status='CONVERTING' AND leased_until=?)가 오래된 작업의 덮어쓰기를 막는다.
CREATE TABLE file_preview (
  file_id           BIGINT      PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  tenant_id         BIGINT      NOT NULL
                      DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                      REFERENCES tenant(id),
  status            VARCHAR(16) NOT NULL
                      CHECK (status IN ('PENDING','CONVERTING','READY','FAILED')),
  failure_code      VARCHAR(32)
                      CHECK (failure_code IN ('UNSUPPORTED','TOO_LARGE','TOO_MANY_PAGES','CONVERT_FAILED',
                                              'BUSY','TIMEOUT','UNAVAILABLE','STORAGE_ERROR')),
  failure_transient BOOLEAN     NOT NULL DEFAULT false,
  attempts          INT         NOT NULL DEFAULT 0,
  page_count        INT,
  -- 변환 엔진 버전(예: rhwp-0.8.7+lo-25.2). 바뀌면 영구 실패도 한 번 더 시도한다.
  engine_version    VARCHAR(64),
  leased_until      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_file_preview_tenant ON file_preview(tenant_id);
-- RLS: V170 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS. PK 가 file_id 라 시퀀스 없음.
ALTER TABLE file_preview ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_preview FORCE ROW LEVEL SECURITY;
CREATE POLICY file_preview_tenant_isolation ON file_preview
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON file_preview TO app_tenant;

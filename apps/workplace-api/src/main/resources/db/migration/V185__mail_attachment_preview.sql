-- WP-432: 메일 첨부 문서 미리보기(서버 변환 PDF) 상태. (tenant_id, content_hash) 단위 1행 — 같은 테넌트의 같은 첨부는
-- 메일·사용자가 달라도 한 번만 변환한다. 상태 컬럼은 V183 file_preview 와 같은 정의다(공용 AbstractPreviewStateRepository).
-- 변환 결과는 암호화해 MailAttachmentBlobStore 루트 아래 "tenant-{tid}/mail-preview/{hash 앞2}/{hash}.enc" 에 두고,
-- READY 때 그 상대 경로를 blob_path 에 기록한다("mail" 세그먼트 아래면 고아 파일 스윕이 지우므로 분리).
--
-- file_preview 를 일반화하지 않는 이유: 드라이브는 file FK CASCADE 로, 메일은 content_attachment 의 해시 참조 수로 수명이
-- 정해진다. 한 테이블로 합치면 nullable 키와 부분 유니크 인덱스(ON CONFLICT 대상)가 필요해진다.
-- FK·CASCADE 는 두지 않는다 — 정리는 refcount-0 규칙(해시를 참조하는 content_attachment 가 없을 때)으로 한다.
CREATE TABLE mail_attachment_preview (
  tenant_id         BIGINT      NOT NULL
                      DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                      REFERENCES tenant(id),
  content_hash      VARCHAR(64) NOT NULL,
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
  -- READY 때 채우는 암호화 PDF 의 상대 경로(MailPreviewKey.previewRef()).
  blob_path         VARCHAR(512),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, content_hash)
);
-- RLS: V170 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS. 시퀀스 없음.
ALTER TABLE mail_attachment_preview ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_attachment_preview FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_attachment_preview_tenant_isolation ON mail_attachment_preview
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_attachment_preview TO app_tenant;

-- WP-369 드라이브 전송 링크: 외부 MCP 클라이언트(curl·브라우저)가 로그인 없이 파일을 내려받거나(DOWNLOAD) 올리는(UPLOAD)
-- 짧은 수명(10분)·일회용 서명 링크. 공유 링크(V78)와 달리 발급자에게 묶이고, 쓸 때 발급자 권한을 다시 확인한다.
-- 토큰은 SHA-256 hex 해시로만 저장한다(평문 미저장).
CREATE TABLE drive_transfer_link (
  id            BIGSERIAL PRIMARY KEY,
  token_hash    VARCHAR(64) NOT NULL,            -- SHA-256 hex(64자)
  kind          VARCHAR(16) NOT NULL,            -- DOWNLOAD | UPLOAD
  user_id       BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,          -- 발급자
  space_id      BIGINT      NOT NULL REFERENCES drive_space(id) ON DELETE CASCADE,
  folder_id     BIGINT      REFERENCES drive_folder(id) ON DELETE CASCADE,             -- 업로드 대상 폴더(NULL = 루트)
  drive_file_id BIGINT      REFERENCES drive_file(id) ON DELETE CASCADE,               -- 다운로드 대상
  file_name     VARCHAR(255),                    -- 업로드할 파일 이름(정리된 값)
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,                     -- NULL = 미사용. 원자적 소비로 한 번만 채워진다
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id     BIGINT      NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id),
  CONSTRAINT ck_drive_transfer_link_kind CHECK (kind IN ('DOWNLOAD', 'UPLOAD')),
  -- 종류별 필수 대상: 다운로드는 파일, 업로드는 파일 이름
  CONSTRAINT ck_drive_transfer_link_target CHECK (
    (kind = 'DOWNLOAD' AND drive_file_id IS NOT NULL)
    OR (kind = 'UPLOAD' AND file_name IS NOT NULL))
);
CREATE UNIQUE INDEX uq_drive_transfer_link_token ON drive_transfer_link(token_hash);
-- 발급 시 발급자의 만료 행 정리용
CREATE INDEX idx_drive_transfer_link_user_expires ON drive_transfer_link(user_id, expires_at);
CREATE INDEX idx_drive_transfer_link_tenant ON drive_transfer_link(tenant_id);

-- RLS: V78 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE drive_transfer_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_transfer_link FORCE ROW LEVEL SECURITY;
CREATE POLICY drive_transfer_link_tenant_isolation ON drive_transfer_link
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_transfer_link TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE drive_transfer_link_id_seq TO app_tenant;

-- 공개 resolve 전용(테넌트 컨텍스트 없음): 소유자 app(BYPASSRLS) 소유 SECURITY DEFINER 로 RLS 우회.
-- 소비 실패(0행) 시 "없는 토큰(404)"과 "만료·사용됨(410)"을 가르는 데 쓴다.
CREATE FUNCTION drive_transfer_link_resolve(p_token_hash VARCHAR)
RETURNS TABLE(id BIGINT, tenant_id BIGINT, kind VARCHAR, user_id BIGINT, space_id BIGINT,
              folder_id BIGINT, drive_file_id BIGINT, file_name VARCHAR,
              expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.tenant_id, t.kind, t.user_id, t.space_id, t.folder_id, t.drive_file_id,
         t.file_name, t.expires_at, t.used_at
  FROM drive_transfer_link t WHERE t.token_hash = p_token_hash $$;
GRANT EXECUTE ON FUNCTION drive_transfer_link_resolve(VARCHAR) TO app_tenant;

-- 공개 원자적 소비(테넌트 컨텍스트 없음): 미사용·만료 전·종류 일치일 때만 used_at 을 채우고 그 행을 돌려준다.
-- 동시 요청은 행 잠금으로 직렬화되어 정확히 하나만 1행을 받는다. 다운로드(GET)·업로드(PUT) 공용.
CREATE FUNCTION drive_transfer_link_consume(p_token_hash VARCHAR, p_kind VARCHAR)
RETURNS TABLE(id BIGINT, tenant_id BIGINT, kind VARCHAR, user_id BIGINT, space_id BIGINT,
              folder_id BIGINT, drive_file_id BIGINT, file_name VARCHAR,
              expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE drive_transfer_link t SET used_at = now()
  WHERE t.token_hash = p_token_hash AND t.kind = p_kind
    AND t.used_at IS NULL AND t.expires_at > now()
  RETURNING t.id, t.tenant_id, t.kind, t.user_id, t.space_id, t.folder_id, t.drive_file_id,
            t.file_name, t.expires_at, t.used_at $$;
GRANT EXECUTE ON FUNCTION drive_transfer_link_consume(VARCHAR, VARCHAR) TO app_tenant;

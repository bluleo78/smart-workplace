-- 공유 링크(#78): 파일당 다중 링크, 만료·비밀번호·폐기. 토큰은 SHA-256 해시로만 저장.
-- 공개 다운로드 resolve 는 RLS 우회가 필요하므로 SECURITY DEFINER 함수 제공(소유자 app=BYPASSRLS).
CREATE TABLE drive_share_link (
  id            BIGSERIAL PRIMARY KEY,
  drive_file_id BIGINT NOT NULL REFERENCES drive_file(id) ON DELETE CASCADE,
  space_id      BIGINT NOT NULL REFERENCES drive_space(id) ON DELETE CASCADE,
  token_hash    VARCHAR(64) NOT NULL,            -- SHA-256 hex(64자), 평문 미저장
  audience      VARCHAR(16) NOT NULL,            -- EXTERNAL | INTERNAL
  password_hash VARCHAR(255),                    -- BCrypt, NULL = 비번 없음
  expires_at    TIMESTAMPTZ,                     -- NULL = 무기한
  revoked_at    TIMESTAMPTZ,                     -- NULL = 활성
  created_by    BIGINT NOT NULL REFERENCES "user"(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id     BIGINT NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id)
);
CREATE UNIQUE INDEX uq_drive_share_link_token ON drive_share_link(token_hash);
CREATE INDEX idx_drive_share_link_file ON drive_share_link(drive_file_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_drive_share_link_tenant ON drive_share_link(tenant_id);

-- RLS: V53 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE drive_share_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_share_link FORCE ROW LEVEL SECURITY;
CREATE POLICY drive_share_link_tenant_isolation ON drive_share_link
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 런타임 롤에 DML 권한(다른 테이블은 V44 ALTER DEFAULT PRIVILEGES 로 자동 부여되나, 명시 부여로 안전).
GRANT SELECT, INSERT, UPDATE, DELETE ON drive_share_link TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE drive_share_link_id_seq TO app_tenant;

-- 공개 resolve 전용: 소유자 app(BYPASSRLS) 가 함수 소유 → SECURITY DEFINER 로 RLS 우회.
CREATE FUNCTION drive_share_link_resolve(p_token_hash VARCHAR)
RETURNS TABLE(tenant_id BIGINT, drive_file_id BIGINT, password_hash VARCHAR,
              audience VARCHAR, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.tenant_id, s.drive_file_id, s.password_hash, s.audience, s.expires_at, s.revoked_at
  FROM drive_share_link s WHERE s.token_hash = p_token_hash $$;
GRANT EXECUTE ON FUNCTION drive_share_link_resolve(VARCHAR) TO app_tenant;

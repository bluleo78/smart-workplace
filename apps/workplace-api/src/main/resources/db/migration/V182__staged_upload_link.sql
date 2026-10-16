-- WP-421 스테이징 업로드 링크: 외부 MCP 클라이언트(curl)가 로그인 없이 임시 첨부(스테이징 파일)를 올리는 10분짜리 일회용 PUT 링크.
-- 올린 파일은 발급자의 임시 ATTACHMENT 파일이 되고, 이슈·메시지·노트 등이 fileIds 로 가져가 묶는다(클레임).
-- drive_transfer_link(V165)를 재사용하지 않는 이유: space_id NOT NULL·kind CHECK·고정 반환형 함수라 제자리에서 바꿔야 하고,
-- core file 이 drive 표를 알게 된다. 새 표·새 함수는 구 파드에 영향이 없다(expand only).
-- 토큰은 SHA-256 hex 해시로만 저장한다(평문 미저장).
CREATE TABLE staged_upload_link (
  id          BIGSERIAL PRIMARY KEY,
  token_hash  VARCHAR(64)  NOT NULL,            -- SHA-256 hex(64자)
  user_id     BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,  -- 발급자(= 올린 파일의 업로더)
  file_name   VARCHAR(255) NOT NULL,            -- 저장할 파일 이름(정리된 값)
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,                      -- NULL = 미사용. 원자적 소비로 한 번만 채워진다
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  tenant_id   BIGINT       NOT NULL
                DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                REFERENCES tenant(id)
);
CREATE UNIQUE INDEX uq_staged_upload_link_token ON staged_upload_link(token_hash);
-- 발급 시 발급자의 만료 행 정리용
CREATE INDEX idx_staged_upload_link_user_expires ON staged_upload_link(user_id, expires_at);
CREATE INDEX idx_staged_upload_link_tenant ON staged_upload_link(tenant_id);

-- RLS: V78·V165 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE staged_upload_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE staged_upload_link FORCE ROW LEVEL SECURITY;
CREATE POLICY staged_upload_link_tenant_isolation ON staged_upload_link
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON staged_upload_link TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE staged_upload_link_id_seq TO app_tenant;

-- 공개 resolve 전용(테넌트 컨텍스트 없음): 소유자 app(BYPASSRLS) 소유 SECURITY DEFINER 로 RLS 우회.
-- 본문 전 확인과, 소비 실패(0행) 시 "없는 토큰(404)"과 "만료·사용됨(410)"을 가르는 데 쓴다.
CREATE FUNCTION staged_upload_link_resolve(p_token_hash VARCHAR)
RETURNS TABLE(id BIGINT, tenant_id BIGINT, user_id BIGINT, file_name VARCHAR,
              expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.tenant_id, t.user_id, t.file_name, t.expires_at, t.used_at
  FROM staged_upload_link t WHERE t.token_hash = p_token_hash $$;
-- 함수는 기본으로 PUBLIC 에 EXECUTE 가 열린다 — 쓰는 롤(app_tenant)에만 준다(V163 관례).
REVOKE ALL ON FUNCTION staged_upload_link_resolve(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staged_upload_link_resolve(VARCHAR) TO app_tenant;

-- 공개 원자적 소비(테넌트 컨텍스트 없음): 미사용·만료 전일 때만 used_at 을 채우고 그 행을 돌려준다.
-- 동시 요청은 행 잠금으로 직렬화되어 정확히 하나만 1행을 받는다.
CREATE FUNCTION staged_upload_link_consume(p_token_hash VARCHAR)
RETURNS TABLE(id BIGINT, tenant_id BIGINT, user_id BIGINT, file_name VARCHAR,
              expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE staged_upload_link t SET used_at = now()
  WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
  RETURNING t.id, t.tenant_id, t.user_id, t.file_name, t.expires_at, t.used_at $$;
REVOKE ALL ON FUNCTION staged_upload_link_consume(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staged_upload_link_consume(VARCHAR) TO app_tenant;

-- 만료 행 주기 정리(테넌트 컨텍스트 없음 — 정리 스케줄러가 부른다): 만료 뒤 하루가 지난 행을 모든 테넌트에서 지운다.
-- 하루를 남기는 것은 막 만료·사용된 링크를 다시 쓰려는 요청이 404(없음)가 아니라 410(만료·사용됨)을 받게 하려는 것이다.
CREATE FUNCTION staged_upload_link_purge_expired()
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH d AS (
    DELETE FROM staged_upload_link t WHERE t.expires_at < now() - interval '1 day' RETURNING 1)
  SELECT count(*)::int FROM d $$;
REVOKE ALL ON FUNCTION staged_upload_link_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staged_upload_link_purge_expired() TO app_tenant;

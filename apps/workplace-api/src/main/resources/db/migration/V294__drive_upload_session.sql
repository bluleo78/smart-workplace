-- V294 (WP-1520): 드라이브 나눠 올리기(이어 올리기) 세션. 큰 파일을 조각(기본 8MB)으로 나눠 PUT 하고, 끊겨도 받은 바이트부터 이어 올린다.
-- 새 테이블·새 함수만 더한다(expand only — 구 파드에 영향 없음).
--
-- 받은 바이트는 저장소 루트의 임시 파일(tenant-{tenant_id}/upload-sessions/{id}.part)에 이어 쓰고, 이 행은 진행 상태만 든다.
-- id 는 앱이 만든 무작위 UUID — 추측할 수 없고, 조회·쓰기는 언제나 owner_id 로 한 번 더 거른다(남의 세션은 404).
-- space_id·folder_id 에는 FK 를 걸지 않는다: 공간·폴더가 지워질 때 CASCADE 로 행만 사라지면 임시 파일이 영영 남는다.
-- 행을 남겨 두면 complete 가 권한·폴더 검사에서 거절하고, 만료 정리가 행과 임시 파일을 함께 지운다.
CREATE TABLE drive_upload_session (
  id              UUID         PRIMARY KEY,
  tenant_id       BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  owner_id        BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  space_id        BIGINT       NOT NULL,
  folder_id       BIGINT,
  file_name       TEXT         NOT NULL,
  content_type    TEXT,
  total_size      BIGINT       NOT NULL CHECK (total_size > 0),
  received_bytes  BIGINT       NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= total_size),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ  NOT NULL,
  CONSTRAINT fk_drive_upload_session_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_drive_upload_session_tenant ON drive_upload_session(tenant_id);
CREATE INDEX idx_drive_upload_session_owner ON drive_upload_session(owner_id);
-- 만료 정리(테넌트 횡단 purge)가 만료 시각으로 찾는다.
CREATE INDEX idx_drive_upload_session_expires ON drive_upload_session(expires_at);

-- RLS: V285 와 같은 모양(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE drive_upload_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_upload_session FORCE ROW LEVEL SECURITY;
CREATE POLICY drive_upload_session_tenant_isolation ON drive_upload_session
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_upload_session TO app_tenant;

-- 만료 행 주기 정리(테넌트 컨텍스트 없음 — 정리 스케줄러가 부른다): 만료된 행을 모든 테넌트에서 지우고 id·tenant_id 를 돌려준다.
-- 스케줄러는 돌려받은 값으로 임시 파일 경로를 만들어 지운다. FORCE RLS 라 소유자 app(BYPASSRLS) 소유 SECURITY DEFINER 로 우회한다(V182 관례).
CREATE FUNCTION drive_upload_session_purge_expired()
RETURNS TABLE(id UUID, tenant_id BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM drive_upload_session s WHERE s.expires_at < now()
  RETURNING s.id, s.tenant_id $$;
-- 함수는 기본으로 PUBLIC 에 EXECUTE 가 열린다 — 쓰는 롤(app_tenant)에만 준다(V163 관례).
REVOKE ALL ON FUNCTION drive_upload_session_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION drive_upload_session_purge_expired() TO app_tenant;

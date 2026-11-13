-- WP-1538: 폴더 공유 링크. expand-only — 기존 파일 링크 행은 그대로 유효.
ALTER TABLE drive_share_link
  ALTER COLUMN drive_file_id DROP NOT NULL,
  ADD COLUMN drive_folder_id BIGINT REFERENCES drive_folder(id) ON DELETE CASCADE;
-- 링크는 파일 또는 폴더 중 정확히 하나만 가리킨다.
ALTER TABLE drive_share_link
  ADD CONSTRAINT ck_drive_share_link_target CHECK (num_nonnulls(drive_file_id, drive_folder_id) = 1);
CREATE INDEX idx_drive_share_link_folder ON drive_share_link(drive_folder_id)
  WHERE revoked_at IS NULL AND drive_folder_id IS NOT NULL;

-- 반환 칼럼이 바뀌어 CREATE OR REPLACE 불가 → DROP 후 같은 이름으로 다시 만든다(소유자 app 유지, 권한 재부여).
DROP FUNCTION drive_share_link_resolve(VARCHAR);
CREATE FUNCTION drive_share_link_resolve(p_token_hash VARCHAR)
RETURNS TABLE(tenant_id BIGINT, drive_file_id BIGINT, drive_folder_id BIGINT, password_hash VARCHAR,
              audience VARCHAR, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.tenant_id, s.drive_file_id, s.drive_folder_id, s.password_hash, s.audience, s.expires_at, s.revoked_at
  FROM drive_share_link s WHERE s.token_hash = p_token_hash $$;
GRANT EXECUTE ON FUNCTION drive_share_link_resolve(VARCHAR) TO app_tenant;

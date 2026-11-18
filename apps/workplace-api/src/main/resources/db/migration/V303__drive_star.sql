-- WP-1698 드라이브 「별표」: 사람마다 파일·폴더에 별표를 달아 사이드바 「별표」(/drive/starred)에서 모아 본다.
-- 한 행은 한 사람의 별표 하나 — 대상은 파일 또는 폴더 중 정확히 하나(CHECK). 별표는 권한을 주지 않는다: 목록을 읽을 때마다
-- 그 공간의 실효 멤버인지·항목이 휴지통에 없는지를 SQL 로 다시 거른다. 그래서 구성원에서 빠져도 행은 지우지 않는다(다시 들어오면 돌아온다).
-- 항목을 영구 삭제하거나 공간을 지우면(drive_file·drive_folder CASCADE) 별표 행도 함께 지워진다. 사람이 지워지면 그 사람의 별표도 지운다.
-- 새 테이블만 추가하는 expand-only 라 롤링 배포에 안전하다(이전 버전 앱은 이 표를 모른다).
CREATE TABLE drive_star (
  id              BIGSERIAL   PRIMARY KEY,
  tenant_id       BIGINT      NOT NULL
                    DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                    REFERENCES tenant(id),
  user_id         BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  drive_file_id   BIGINT      REFERENCES drive_file(id) ON DELETE CASCADE,
  drive_folder_id BIGINT      REFERENCES drive_folder(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 대상은 파일 또는 폴더 중 정확히 하나.
  CONSTRAINT ck_drive_star_target CHECK (num_nonnulls(drive_file_id, drive_folder_id) = 1)
);
-- 한 사람이 한 항목에 별표는 하나 — 넣기(ON CONFLICT DO NOTHING)가 멱등이 되는 기준. 대상 칸이 둘이라 부분 유일 인덱스 두 개로 나눈다.
CREATE UNIQUE INDEX uq_drive_star_user_file ON drive_star (user_id, drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE UNIQUE INDEX uq_drive_star_user_folder ON drive_star (user_id, drive_folder_id) WHERE drive_folder_id IS NOT NULL;
-- 내 별표 목록(별표한 순, 키셋 커서) 조회용.
CREATE INDEX idx_drive_star_user_created ON drive_star (user_id, created_at DESC, id DESC);
-- 파일·폴더 영구 삭제 CASCADE 가 별표 행을 빨리 찾게 — 위 유일 인덱스는 user_id 가 앞이라 이 조회를 받치지 못한다.
CREATE INDEX idx_drive_star_file ON drive_star (drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE INDEX idx_drive_star_folder ON drive_star (drive_folder_id) WHERE drive_folder_id IS NOT NULL;

-- RLS: drive_share_link_visit(V292) 와 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE drive_star ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_star FORCE ROW LEVEL SECURITY;
CREATE POLICY drive_star_tenant_isolation ON drive_star
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_star TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE drive_star_id_seq TO app_tenant;

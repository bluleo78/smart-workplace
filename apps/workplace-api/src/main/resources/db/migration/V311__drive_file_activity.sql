-- WP-1699 드라이브 「최근」: 한 사람이 어떤 드라이브 파일을 열거나 올리거나 새 판을 올렸는지의 기록.
-- 공간을 가로질러 「내가 최근 만진 파일」 목록(GET /api/v1/drive/recent)을 만드는 원본이다.
-- 한 사람·한 파일 한 행(upsert) — last_action/last_at 만 갱신하고, 사람마다 최근 500개만 둔다(앱이 새 행 INSERT 때 정리).
-- 기록은 권한을 주지 않는다 — 목록을 읽을 때마다 그 공간의 실효 역할과 휴지통 여부로 다시 거른다.
-- 파일·사용자 삭제 시 CASCADE. 새 테이블만 추가하는 expand-only 라 롤링 배포에 안전하다.
CREATE TABLE drive_file_activity (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     BIGINT      NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id),
  user_id       BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  drive_file_id BIGINT      NOT NULL REFERENCES drive_file(id) ON DELETE CASCADE,
  last_action   VARCHAR(16) NOT NULL CHECK (last_action IN ('OPEN', 'UPLOAD', 'NEW_VERSION')),
  first_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- upsert(ON CONFLICT) 대상 키 — 한 사람의 한 파일은 한 행.
  CONSTRAINT uq_drive_file_activity UNIQUE (user_id, drive_file_id)
);
-- 내 목록(최근 순, 커서 (last_at, id)) 조회용.
CREATE INDEX idx_drive_file_activity_user_last ON drive_file_activity (user_id, last_at DESC, id DESC);
-- 파일 삭제 CASCADE 가 기록 행을 빨리 찾게.
CREATE INDEX idx_drive_file_activity_file ON drive_file_activity (drive_file_id);

-- RLS: drive_share_link_visit(V292) 와 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE drive_file_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_file_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY drive_file_activity_tenant_isolation ON drive_file_activity
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_file_activity TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE drive_file_activity_id_seq TO app_tenant;

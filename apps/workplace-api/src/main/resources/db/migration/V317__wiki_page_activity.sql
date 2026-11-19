-- WP-1764 노트 「최근」: 한 사람이 어떤 노트 페이지를 열거나 고쳤는지의 기록.
-- 공간을 가로질러 「내가 최근 만진 노트」 목록(GET /api/v1/wiki/recent)을 만드는 원본이다.
-- 한 사람·한 페이지 한 행(upsert) — last_action/last_at 만 갱신하고, 사람마다 최근 500개만 둔다(앱이 새 행 INSERT 때 정리).
-- 기록은 권한을 주지 않는다 — 목록을 읽을 때마다 그 공간의 실효 멤버십으로 다시 거른다.
-- 페이지·사용자 삭제 시 CASCADE. 새 테이블만 추가하는 expand-only 라 롤링 배포에 안전하다.
CREATE TABLE wiki_page_activity (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     BIGINT      NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id),
  user_id       BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  wiki_page_id  BIGINT      NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  last_action   VARCHAR(16) NOT NULL CHECK (last_action IN ('OPEN', 'EDIT')),
  first_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- upsert(ON CONFLICT) 대상 키 — 한 사람의 한 페이지는 한 행.
  CONSTRAINT uq_wiki_page_activity UNIQUE (user_id, wiki_page_id)
);
-- 내 목록(최근 순, 커서 (last_at, id)) 조회용.
CREATE INDEX idx_wiki_page_activity_user_last ON wiki_page_activity (user_id, last_at DESC, id DESC);
-- 페이지 삭제 CASCADE 가 기록 행을 빨리 찾게.
CREATE INDEX idx_wiki_page_activity_page ON wiki_page_activity (wiki_page_id);

-- RLS: drive_file_activity(V311) 와 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE wiki_page_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_page_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_activity_tenant_isolation ON wiki_page_activity
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_page_activity TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE wiki_page_activity_id_seq TO app_tenant;

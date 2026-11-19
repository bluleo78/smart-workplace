-- WP-1765 노트 페이지 「즐겨찾기」: 한 사람이 어떤 노트 페이지를 즐겨찾기했는지의 기록.
-- 공간을 가로질러 「내 즐겨찾기」 목록(GET /api/v1/wiki/starred)을 만드는 원본이다. 드라이브 별표(V303 drive_star)와 같은 모양.
-- 한 사람·한 페이지 한 행 — 넣기는 ON CONFLICT DO NOTHING 으로 멱등이다.
-- 기록은 권한을 주지 않는다 — 목록을 읽을 때마다 그 공간의 실효 멤버십으로 다시 거른다.
-- 페이지·사용자 삭제 시 CASCADE. 새 테이블만 추가하는 expand-only 라 롤링 배포에 안전하다.
CREATE TABLE wiki_page_star (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     BIGINT      NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id),
  user_id       BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  wiki_page_id  BIGINT      NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 한 사람의 한 페이지는 한 행(넣기 멱등의 충돌 대상 키).
  CONSTRAINT uq_wiki_page_star UNIQUE (user_id, wiki_page_id)
);
-- 내 목록(즐겨찾기한 순, 커서 (created_at, id)) 조회용.
CREATE INDEX idx_wiki_page_star_user_created ON wiki_page_star (user_id, created_at DESC, id DESC);
-- 페이지 삭제 CASCADE 가 행을 빨리 찾게.
CREATE INDEX idx_wiki_page_star_page ON wiki_page_star (wiki_page_id);

-- RLS: wiki_page_activity(V317) 와 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE wiki_page_star ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_page_star FORCE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_star_tenant_isolation ON wiki_page_star
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_page_star TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE wiki_page_star_id_seq TO app_tenant;

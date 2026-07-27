-- 노트 페이지 본문에 삽입된 이미지 첨부 매핑.
-- file 에도 tenant_id/RLS 가 있으므로(V52·V53) 격리는 이중이다 — 이 매핑 테이블에도 같은 정책을 걸어
-- file 을 거치지 않는 조회 경로(페이지별 첨부 목록·개수)에서도 테넌트가 새지 않게 한다.
-- issue_attachment(V8)는 멀티테넌시 도입 전 유물이라 tenant_id 가 없다 — 베끼지 않는다.
CREATE TABLE wiki_page_attachment (
  file_id     BIGINT      PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  tenant_id   BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  page_id     BIGINT      NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  attached_by BIGINT      NOT NULL REFERENCES "user"(id),
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wiki_page_attachment_tenant ON wiki_page_attachment(tenant_id);
CREATE INDEX idx_wiki_page_attachment_page ON wiki_page_attachment(page_id);

ALTER TABLE wiki_page_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_attachment_tenant_isolation ON wiki_page_attachment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

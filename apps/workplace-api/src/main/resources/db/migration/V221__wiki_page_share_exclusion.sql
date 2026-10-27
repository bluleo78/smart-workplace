-- V221 (WP-987): 하위 페이지가 상위 페이지의 「하위 포함」 공유에서 빠지는 표시.
--
-- 상위 공유를 하위 페이지가 상속할 때, 하위 쪽에서 「이 페이지와 하위는 상위 공유에서 제외」를 켤 수 있게 한다. 표시가 있는 페이지와 그 서브트리는
-- 그 위의 어떤 하위 포함 공유로도 열리지 않는다(그 페이지가 따로 켠 공유는 그대로 열린다). 표시는 페이지당 한 행이라 PK 가 page_id 다.
-- 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모르고, 표시가 없을 때의 판정은 지금과 같다).
--
-- - 페이지가 지워지면 함께 지운다. 표시한 사람이 지워지면 NULL.
-- - V195 의 테넌트 패턴(tenant_id 기본값 GUC, RLS USING + WITH CHECK, app_tenant 권한 명시).
CREATE TABLE wiki_page_share_exclusion (
  page_id    BIGINT      PRIMARY KEY REFERENCES wiki_page(id) ON DELETE CASCADE,
  tenant_id  BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                         REFERENCES tenant(id),
  created_by BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wiki_page_share_exclusion_tenant ON wiki_page_share_exclusion(tenant_id);
CREATE INDEX idx_wiki_page_share_exclusion_created_by ON wiki_page_share_exclusion(created_by);

ALTER TABLE wiki_page_share_exclusion ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_share_exclusion_tenant_isolation ON wiki_page_share_exclusion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_page_share_exclusion TO app_tenant;

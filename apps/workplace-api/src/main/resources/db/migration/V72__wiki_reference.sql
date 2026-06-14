-- V72: wiki_reference — 위키 페이지가 참조하는 대상(다른 페이지/이슈) 추적 → 백링크.
-- 유저 멘션(<@id>)은 칩 렌더만 하므로 적재하지 않는다. page/issue 참조만 저장.
-- 신규 테이블이라 tenant_id 는 생성 시 바로 NOT NULL + DEFAULT(GUC). 백필 불필요.
-- RLS 는 V67/V68 와 동일한 NULLIF fail-closed 패턴(소유자 롤 app 은 BYPASSRLS).

CREATE TABLE wiki_reference (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                              REFERENCES tenant(id),
  source_page_id BIGINT       NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  target_type    VARCHAR(16)  NOT NULL,   -- 'PAGE' | 'ISSUE'
  target_id      BIGINT       NOT NULL,   -- PAGE=wiki_page.id, ISSUE=issue.id (전역 PK)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT wiki_reference_uq UNIQUE (source_page_id, target_type, target_id)
);

CREATE INDEX idx_wiki_reference_tenant ON wiki_reference(tenant_id);
CREATE INDEX idx_wiki_reference_target ON wiki_reference(target_type, target_id);
CREATE INDEX idx_wiki_reference_source ON wiki_reference(source_page_id);

ALTER TABLE wiki_reference ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_reference_tenant_isolation ON wiki_reference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

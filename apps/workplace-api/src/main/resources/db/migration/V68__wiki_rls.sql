-- V68: 위키 도메인 4개 테이블 RLS 활성화. V53(drive)/V48(issue) 과 동일한 NULLIF fail-closed 패턴.
-- GUC 미설정/빈문자열 → NULL → 어떤 행과도 매칭 안 됨(비가시). 소유자 롤(app)은 BYPASSRLS.

ALTER TABLE wiki_space ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_space_tenant_isolation ON wiki_space
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

ALTER TABLE wiki_space_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_space_member_tenant_isolation ON wiki_space_member
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

ALTER TABLE wiki_page ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_tenant_isolation ON wiki_page
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

ALTER TABLE wiki_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_revision_tenant_isolation ON wiki_revision
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

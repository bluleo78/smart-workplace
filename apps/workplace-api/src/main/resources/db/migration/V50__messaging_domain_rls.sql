-- V50: messaging 5개 테이블 RLS 활성화
-- V49 에서 추가된 tenant_id 컬럼을 기반으로 RLS 를 활성화.
-- V45/V48 의 NULLIF fail-closed 패턴 적용: GUC 미설정 시 NULL → 모든 행 차단.
-- 강제(FORCE)는 app_tenant 롤만(BYPASSRLS 없음); 소유자 app 는 BYPASSRLS 로 영향 없음.

-- channel
ALTER TABLE channel ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_tenant_isolation ON channel
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- channel_member
ALTER TABLE channel_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_member_tenant_isolation ON channel_member
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- message
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_tenant_isolation ON message
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- message_reaction
ALTER TABLE message_reaction ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_reaction_tenant_isolation ON message_reaction
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- message_attachment
ALTER TABLE message_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_attachment_tenant_isolation ON message_attachment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- V48: issue 도메인 18개 테이블 RLS 활성화.
-- V45 카나리아와 동일한 NULLIF fail-closed 패턴 사용:
--   NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   → GUC 미설정(NULL) 또는 빈 문자열('')이면 NULL 로 환산 → 비가시(fail-closed).
-- 강제는 app_tenant 런타임에만 적용됨 (소유자 app 은 BYPASSRLS 권한 보유).
-- 처리 순서: V47 과 동일 (project 루트 → 직계 자식 → issue → issue 자식).

-- ============================================================
-- 1) project
-- ============================================================
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_tenant_isolation ON project
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 2) label
-- ============================================================
ALTER TABLE label ENABLE ROW LEVEL SECURITY;
CREATE POLICY label_tenant_isolation ON label
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 3) issue_type_def
-- ============================================================
ALTER TABLE issue_type_def ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_type_def_tenant_isolation ON issue_type_def
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 4) issue_field_def
-- ============================================================
ALTER TABLE issue_field_def ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_field_def_tenant_isolation ON issue_field_def
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 5) cycle
-- ============================================================
ALTER TABLE cycle ENABLE ROW LEVEL SECURITY;
CREATE POLICY cycle_tenant_isolation ON cycle
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 6) saved_view
-- ============================================================
ALTER TABLE saved_view ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_view_tenant_isolation ON saved_view
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 7) project_member
-- ============================================================
ALTER TABLE project_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_member_tenant_isolation ON project_member
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 8) project_issue_sequence
-- ============================================================
ALTER TABLE project_issue_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_issue_sequence_tenant_isolation ON project_issue_sequence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 9) issue
-- ============================================================
ALTER TABLE issue ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_tenant_isolation ON issue
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 10) issue_comment
-- ============================================================
ALTER TABLE issue_comment ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_comment_tenant_isolation ON issue_comment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 11) issue_history
-- ============================================================
ALTER TABLE issue_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_history_tenant_isolation ON issue_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 12) issue_attachment
-- ============================================================
ALTER TABLE issue_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_attachment_tenant_isolation ON issue_attachment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 13) issue_assignee
-- ============================================================
ALTER TABLE issue_assignee ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_assignee_tenant_isolation ON issue_assignee
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 14) issue_label
-- ============================================================
ALTER TABLE issue_label ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_label_tenant_isolation ON issue_label
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 15) issue_watcher
-- ============================================================
ALTER TABLE issue_watcher ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_watcher_tenant_isolation ON issue_watcher
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 16) issue_cycle
-- ============================================================
ALTER TABLE issue_cycle ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_cycle_tenant_isolation ON issue_cycle
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 17) issue_dependency
-- ============================================================
ALTER TABLE issue_dependency ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_dependency_tenant_isolation ON issue_dependency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ============================================================
-- 18) issue_field_value
-- ============================================================
ALTER TABLE issue_field_value ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_field_value_tenant_isolation ON issue_field_value
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

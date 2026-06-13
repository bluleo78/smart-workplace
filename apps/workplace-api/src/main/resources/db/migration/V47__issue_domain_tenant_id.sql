-- V47: issue 도메인 18개 테이블에 tenant_id 컬럼 추가 + 백필 + FK.
-- RLS 활성화는 V48 에서 수행 — 이 마이그레이션은 컬럼/인덱스/FK 만.
-- DEFAULT 는 백필 완료 후 추가한다:
--   Flyway 는 superuser(app)로 실행되며 GUC(app.tenant_id)가 미설정 상태이므로,
--   DEFAULT 를 먼저 붙이면 nullable->notnull 전환 시 current_setting 이 NULL 을 반환해
--   NOT NULL 위반이 발생한다. 백필 후 DEFAULT 설정 순서를 반드시 지킨다.
-- 처리 순서: project(루트) → project 직계 자식(2-8) → issue(9) → issue 자식(10-18).
--   각 자식 백필은 부모의 tenant_id 를 읽으므로 부모 먼저.

-- ============================================================
-- 1) project (루트: tenant_id = 1 고정)
-- ============================================================
ALTER TABLE project ADD COLUMN tenant_id BIGINT;

UPDATE project SET tenant_id = 1;

ALTER TABLE project ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE project ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE project ADD CONSTRAINT fk_project_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_project_tenant ON project(tenant_id);

-- ============================================================
-- 2) label (project_id → project)
-- ============================================================
ALTER TABLE label ADD COLUMN tenant_id BIGINT;

UPDATE label c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE label ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE label ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE label ADD CONSTRAINT fk_label_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_label_tenant ON label(tenant_id);

-- ============================================================
-- 3) issue_type_def (project_id → project)
-- ============================================================
ALTER TABLE issue_type_def ADD COLUMN tenant_id BIGINT;

UPDATE issue_type_def c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE issue_type_def ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_type_def ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_type_def ADD CONSTRAINT fk_issue_type_def_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_type_def_tenant ON issue_type_def(tenant_id);

-- ============================================================
-- 4) issue_field_def (project_id → project)
-- ============================================================
ALTER TABLE issue_field_def ADD COLUMN tenant_id BIGINT;

UPDATE issue_field_def c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE issue_field_def ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_field_def ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_field_def ADD CONSTRAINT fk_issue_field_def_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_field_def_tenant ON issue_field_def(tenant_id);

-- ============================================================
-- 5) cycle (project_id → project)
-- ============================================================
ALTER TABLE cycle ADD COLUMN tenant_id BIGINT;

UPDATE cycle c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE cycle ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE cycle ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE cycle ADD CONSTRAINT fk_cycle_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_cycle_tenant ON cycle(tenant_id);

-- ============================================================
-- 6) saved_view (project_id → project)
-- ============================================================
ALTER TABLE saved_view ADD COLUMN tenant_id BIGINT;

UPDATE saved_view c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE saved_view ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE saved_view ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE saved_view ADD CONSTRAINT fk_saved_view_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_saved_view_tenant ON saved_view(tenant_id);

-- ============================================================
-- 7) project_member (project_id → project)
-- ============================================================
ALTER TABLE project_member ADD COLUMN tenant_id BIGINT;

UPDATE project_member c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE project_member ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE project_member ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE project_member ADD CONSTRAINT fk_project_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_project_member_tenant ON project_member(tenant_id);

-- ============================================================
-- 8) project_issue_sequence (project_id → project)
-- ============================================================
ALTER TABLE project_issue_sequence ADD COLUMN tenant_id BIGINT;

UPDATE project_issue_sequence c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE project_issue_sequence ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE project_issue_sequence ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE project_issue_sequence ADD CONSTRAINT fk_project_issue_sequence_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_project_issue_sequence_tenant ON project_issue_sequence(tenant_id);

-- ============================================================
-- 9) issue (project_id → project)
-- ============================================================
ALTER TABLE issue ADD COLUMN tenant_id BIGINT;

UPDATE issue c SET tenant_id = p.tenant_id FROM project p WHERE c.project_id = p.id;

ALTER TABLE issue ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue ADD CONSTRAINT fk_issue_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_tenant ON issue(tenant_id);

-- ============================================================
-- 10) issue_comment (issue_id → issue)
-- ============================================================
ALTER TABLE issue_comment ADD COLUMN tenant_id BIGINT;

UPDATE issue_comment c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_comment ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_comment ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_comment ADD CONSTRAINT fk_issue_comment_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_comment_tenant ON issue_comment(tenant_id);

-- ============================================================
-- 11) issue_history (issue_id → issue)
-- ============================================================
ALTER TABLE issue_history ADD COLUMN tenant_id BIGINT;

UPDATE issue_history c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_history ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_history ADD CONSTRAINT fk_issue_history_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_history_tenant ON issue_history(tenant_id);

-- ============================================================
-- 12) issue_attachment (issue_id → issue)
-- ============================================================
ALTER TABLE issue_attachment ADD COLUMN tenant_id BIGINT;

UPDATE issue_attachment c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_attachment ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_attachment ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_attachment ADD CONSTRAINT fk_issue_attachment_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_attachment_tenant ON issue_attachment(tenant_id);

-- ============================================================
-- 13) issue_assignee (issue_id → issue)
-- ============================================================
ALTER TABLE issue_assignee ADD COLUMN tenant_id BIGINT;

UPDATE issue_assignee c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_assignee ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_assignee ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_assignee ADD CONSTRAINT fk_issue_assignee_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_assignee_tenant ON issue_assignee(tenant_id);

-- ============================================================
-- 14) issue_label (issue_id → issue)
-- ============================================================
ALTER TABLE issue_label ADD COLUMN tenant_id BIGINT;

UPDATE issue_label c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_label ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_label ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_label ADD CONSTRAINT fk_issue_label_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_label_tenant ON issue_label(tenant_id);

-- ============================================================
-- 15) issue_watcher (issue_id → issue)
-- ============================================================
ALTER TABLE issue_watcher ADD COLUMN tenant_id BIGINT;

UPDATE issue_watcher c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_watcher ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_watcher ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_watcher ADD CONSTRAINT fk_issue_watcher_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_watcher_tenant ON issue_watcher(tenant_id);

-- ============================================================
-- 16) issue_cycle (issue_id → issue)
-- ============================================================
ALTER TABLE issue_cycle ADD COLUMN tenant_id BIGINT;

UPDATE issue_cycle c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_cycle ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_cycle ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_cycle ADD CONSTRAINT fk_issue_cycle_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_cycle_tenant ON issue_cycle(tenant_id);

-- ============================================================
-- 17) issue_dependency (issue_id → issue)
-- ============================================================
ALTER TABLE issue_dependency ADD COLUMN tenant_id BIGINT;

UPDATE issue_dependency c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_dependency ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_dependency ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_dependency ADD CONSTRAINT fk_issue_dependency_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_dependency_tenant ON issue_dependency(tenant_id);

-- ============================================================
-- 18) issue_field_value (issue_id → issue)
-- ============================================================
ALTER TABLE issue_field_value ADD COLUMN tenant_id BIGINT;

UPDATE issue_field_value c SET tenant_id = i.tenant_id FROM issue i WHERE c.issue_id = i.id;

ALTER TABLE issue_field_value ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE issue_field_value ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE issue_field_value ADD CONSTRAINT fk_issue_field_value_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_issue_field_value_tenant ON issue_field_value(tenant_id);

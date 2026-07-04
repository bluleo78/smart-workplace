-- V120__project_timeline.sql
-- 타임라인(간트) 기능: 이슈 시작일 + 마일스톤 도메인 + 이슈-마일스톤 연결.

-- 1) 이슈 시작일 — 간트 기간 막대의 시작점. 마감일보다 늦을 수 없다(둘 다 있을 때만 검사).
ALTER TABLE issue ADD COLUMN start_date DATE;
ALTER TABLE issue ADD CONSTRAINT chk_issue_start_before_due
    CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);

-- 2) 마일스톤 — 프로젝트 스코프 목표 지점(이름+날짜). 최신 테넌트 표준(tenant_id GUC DEFAULT + FORCE RLS, V105 패턴 미러).
CREATE TABLE milestone (
    id          BIGSERIAL PRIMARY KEY,
    -- tenant_id: 런타임 INSERT 시 GUC 가 자동으로 채움(애플리케이션은 명시 안 함). V105 패턴.
    tenant_id   BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                CONSTRAINT fk_milestone_tenant REFERENCES tenant(id),
    project_id  BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    due_date    DATE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, name)
);
CREATE INDEX idx_milestone_project ON milestone(project_id);
CREATE INDEX idx_milestone_tenant  ON milestone(tenant_id);

-- RLS: V59 표준 fail-closed + FORCE. 마이그레이션은 소유자 롤(BYPASSRLS)이라 같은 V120 안전.
ALTER TABLE milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestone FORCE  ROW LEVEL SECURITY;
CREATE POLICY milestone_tenant_isolation ON milestone
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 3) 이슈 → 마일스톤 (이슈당 1개, 마일스톤 삭제 시 연결만 해제)
ALTER TABLE issue ADD COLUMN milestone_id BIGINT REFERENCES milestone(id) ON DELETE SET NULL;
CREATE INDEX idx_issue_milestone ON issue(milestone_id);

-- 4) 권한 시드 — permission 은 전역 카탈로그, role/role_permission 은 테넌트 스코프(V61/V70 RBAC 개편).
--    role_permission.tenant_id 는 DEFAULT 가 GUC 기반이라 Flyway(GUC 미설정) 에선 NULL → 반드시 r.tenant_id 명시(V75 패턴 미러).
INSERT INTO permission (code, description, category) VALUES
    ('milestone:manage', '프로젝트 마일스톤 생성/수정/삭제', 'project');

INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code = 'milestone:manage'
WHERE r.name = 'USER'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code = 'milestone:manage'
WHERE r.name = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

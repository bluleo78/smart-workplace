-- V26__init_cycles.sql
-- 제품 내장 Sprint/Cycle(이터레이션) 도메인.
-- cycle: 프로젝트 스코프. issue_cycle: 이슈↔사이클 M:N (issue 도메인 소유).

CREATE TABLE cycle (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name        VARCHAR(60) NOT NULL,
    goal        TEXT,
    start_date  DATE,
    end_date    DATE,
    status      VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, name),
    CHECK (status IN ('PLANNED', 'ACTIVE', 'COMPLETED'))
);
CREATE INDEX idx_cycle_project ON cycle(project_id);

CREATE TABLE issue_cycle (
    issue_id   BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    cycle_id   BIGINT NOT NULL REFERENCES cycle(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (issue_id, cycle_id)
);
CREATE INDEX idx_issue_cycle_cycle ON issue_cycle(cycle_id);

-- 신규 권한 코드: cycle:manage (프로젝트 사이클 CRUD). 실제 OWNER 검증은 service 의 ProjectAccessGuard.
INSERT INTO permission (code, description, category) VALUES
    ('cycle:manage', '프로젝트 사이클 생성/수정/삭제', 'project');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'USER'
  AND p.code = 'cycle:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'cycle:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

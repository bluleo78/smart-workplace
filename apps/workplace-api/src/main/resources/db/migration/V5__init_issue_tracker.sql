-- V5: 이슈 트래커 골격 (project / issue / comment / history)
-- - Project + ProjectMember
-- - Issue + IssueNumberSequence (프로젝트별 단조 증가)
-- - IssueComment, IssueHistory
-- - 신규 권한 코드 + ADMIN/USER 역할 매핑

CREATE TABLE project (
    id          BIGSERIAL    PRIMARY KEY,
    key         VARCHAR(10)  NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    owner_id    BIGINT       NOT NULL REFERENCES "user"(id),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE project_member (
    project_id BIGINT      NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role       VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id),
    CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE INDEX idx_project_member_user ON project_member(user_id);

-- 프로젝트별 이슈 번호 발급 (UPDATE ... RETURNING 으로 직렬화)
CREATE TABLE project_issue_sequence (
    project_id  BIGINT NOT NULL PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    next_number INT    NOT NULL DEFAULT 1
);

CREATE TABLE issue (
    id           BIGSERIAL    PRIMARY KEY,
    project_id   BIGINT       NOT NULL REFERENCES project(id),
    number       INT          NOT NULL,
    title        VARCHAR(200) NOT NULL,
    body         TEXT,
    status       VARCHAR(16)  NOT NULL DEFAULT 'TODO',
    priority     VARCHAR(8)   NOT NULL DEFAULT 'MID',
    due_date     DATE,
    reporter_id  BIGINT       NOT NULL REFERENCES "user"(id),
    assignee_id  BIGINT       REFERENCES "user"(id),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    closed_at    TIMESTAMPTZ,
    deleted_at   TIMESTAMPTZ,
    CONSTRAINT uq_issue_project_number UNIQUE (project_id, number),
    CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELED')),
    CHECK (priority IN ('LOW', 'MID', 'HIGH'))
);

CREATE INDEX idx_issue_project_status_updated ON issue(project_id, status, updated_at DESC);
CREATE INDEX idx_issue_assignee ON issue(assignee_id);
CREATE INDEX idx_issue_active ON issue(project_id) WHERE deleted_at IS NULL;

CREATE TABLE issue_comment (
    id          BIGSERIAL PRIMARY KEY,
    issue_id    BIGINT    NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    author_id   BIGINT    NOT NULL REFERENCES "user"(id),
    body        TEXT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_issue_comment_issue_created ON issue_comment(issue_id, created_at);

CREATE TABLE issue_history (
    id          BIGSERIAL   PRIMARY KEY,
    issue_id    BIGINT      NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    actor_id    BIGINT      NOT NULL REFERENCES "user"(id),
    event_type  VARCHAR(32) NOT NULL,
    from_value  TEXT,
    to_value    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_issue_history_issue_created ON issue_history(issue_id, created_at);

-- 신규 권한 코드
INSERT INTO permission (code, description, category) VALUES
    ('project:read',   '프로젝트 조회',          'project'),
    ('project:write',  '프로젝트 생성/수정',     'project'),
    ('project:manage', '프로젝트 멤버 관리/삭제', 'project'),
    ('issue:write',    '이슈 생성/수정/코멘트',  'issue');

-- ADMIN 에 신규 권한 전체 부여
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('project:read', 'project:write', 'project:manage', 'issue:write')
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- USER 에 read/write/issue:write 부여 (manage 제외)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'USER'
  AND p.code IN ('project:read', 'project:write', 'issue:write')
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

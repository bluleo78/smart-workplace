-- V7__init_labels_watchers.sql
-- 라벨(프로젝트 스코프) + 이슈 watcher.
-- 이슈-라벨 N:M 매핑은 issue 도메인에서 소유한다.

CREATE TABLE label (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name        VARCHAR(40) NOT NULL,
    color_token VARCHAR(16) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, name)
);
CREATE INDEX idx_label_project ON label(project_id);

CREATE TABLE issue_label (
    issue_id   BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    label_id   BIGINT NOT NULL REFERENCES label(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX idx_issue_label_label ON issue_label(label_id);

CREATE TABLE issue_watcher (
    issue_id   BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX idx_issue_watcher_user ON issue_watcher(user_id);

-- 신규 권한 코드: label:manage (프로젝트 라벨 CRUD)
INSERT INTO permission (code, description, category) VALUES
    ('label:manage', '프로젝트 라벨 생성/수정/삭제', 'project');

-- USER 역할에 label:manage 부여 (실제 OWNER 검증은 service 의 ProjectAccessGuard 에서 수행)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'USER'
  AND p.code = 'label:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ADMIN 도 동일하게 보유
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'label:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

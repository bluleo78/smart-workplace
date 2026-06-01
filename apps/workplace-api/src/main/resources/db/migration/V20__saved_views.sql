-- 저장된 뷰(Saved Views) — 프로젝트별 필터 쿼리스트링을 이름 붙여 저장. 개인(PRIVATE)/공유(SHARED).
CREATE TABLE saved_view (
    id         BIGSERIAL    PRIMARY KEY,
    project_id BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    owner_id   BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name       VARCHAR(60)  NOT NULL,
    query      TEXT         NOT NULL,                       -- filtersToParams 결과 쿼리스트링(불투명)
    visibility VARCHAR(8)   NOT NULL DEFAULT 'PRIVATE',     -- PRIVATE | SHARED
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_saved_view_owner_name UNIQUE (project_id, owner_id, name),
    CONSTRAINT ck_saved_view_visibility CHECK (visibility IN ('PRIVATE','SHARED'))
);
CREATE INDEX idx_saved_view_project ON saved_view(project_id);

-- 신규 권한: savedview:manage (저장된 뷰 CRUD). 실제 소유/공유 검증은 service 에서.
INSERT INTO permission (code, description, category) VALUES
    ('savedview:manage', '프로젝트 저장된 뷰 생성/수정/삭제', 'project');

-- USER 역할에 부여 (멤버 누구나 자기 뷰 생성 가능; 세부 권한은 service)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'USER'
  AND p.code = 'savedview:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ADMIN 도 동일 보유
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'savedview:manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

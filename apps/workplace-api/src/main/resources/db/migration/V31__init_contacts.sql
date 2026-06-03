-- V29: 연락처(contacts) 디렉토리
--   identity 확장: user.title, user_group(조직도+분류), user_group_member(폴리모픽 멤버십)
--   contacts: contact_entry(외부 연락처), contact_favorite(개인 즐겨찾기)
-- 멤버는 가상(외부만 행 저장). 멤버십/즐겨찾기 target 은 폴리모픽이라 DB FK 없이 CHECK + 앱 검증.

-- 1) user.title (직책) — 조직도/멤버 표시용
ALTER TABLE "user" ADD COLUMN title VARCHAR(100);

-- 2) 사용자 그룹: 공유(owner NULL=조직도) / 개인(owner 본인) 트리
CREATE TABLE user_group (
    id         BIGSERIAL    PRIMARY KEY,
    code       VARCHAR(64),                                   -- 외부 동기화용(옵션), 공유 그룹에서 유니크
    name       VARCHAR(100) NOT NULL,
    parent_id  BIGINT       REFERENCES user_group(id) ON DELETE CASCADE,
    owner_id   BIGINT       REFERENCES "user"(id) ON DELETE CASCADE,
    visibility VARCHAR(16)  NOT NULL,
    sort_order INT          NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT user_group_visibility_check CHECK (visibility IN ('SHARED', 'PERSONAL')),
    -- PERSONAL 그룹은 소유자 필수. SHARED 는 소유자 선택(없으면 조직도 공용)
    CONSTRAINT user_group_owner_check CHECK (visibility <> 'PERSONAL' OR owner_id IS NOT NULL)
);
CREATE INDEX idx_user_group_parent ON user_group(parent_id);
CREATE INDEX idx_user_group_owner  ON user_group(owner_id);
-- 공유 그룹 code 는 동기화 upsert 키 → 부분 유니크
CREATE UNIQUE INDEX idx_user_group_code_shared
    ON user_group(code) WHERE code IS NOT NULL AND visibility = 'SHARED';

-- 3) 그룹 멤버십 (폴리모픽: MEMBER→user.id, EXTERNAL→contact_entry.id)
CREATE TABLE user_group_member (
    group_id    BIGINT      NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
    target_type VARCHAR(16) NOT NULL,
    target_id   BIGINT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, target_type, target_id),
    CONSTRAINT user_group_member_type_check CHECK (target_type IN ('MEMBER', 'EXTERNAL'))
);
CREATE INDEX idx_user_group_member_target ON user_group_member(target_type, target_id);

-- 4) 외부 연락처
CREATE TABLE contact_entry (
    id           BIGSERIAL    PRIMARY KEY,
    name         VARCHAR(120) NOT NULL,
    email        VARCHAR(255),
    phone        VARCHAR(40),
    organization VARCHAR(120),
    title        VARCHAR(100),
    notes        TEXT,
    owner_id     BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    visibility   VARCHAR(16)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT contact_entry_visibility_check CHECK (visibility IN ('SHARED', 'PERSONAL'))
);
CREATE INDEX idx_contact_entry_owner ON contact_entry(owner_id);
CREATE INDEX idx_contact_entry_name  ON contact_entry(name);

-- 5) 개인 즐겨찾기 (폴리모픽)
CREATE TABLE contact_favorite (
    owner_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    target_type VARCHAR(16) NOT NULL,
    target_id   BIGINT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, target_type, target_id),
    CONSTRAINT contact_favorite_type_check CHECK (target_type IN ('MEMBER', 'EXTERNAL'))
);

-- 6) 권한 시드 + 역할 부여
INSERT INTO permission (code, description, category) VALUES
    ('contact:read',      '연락처 조회',                  'contact'),
    ('contact:write',     '외부 연락처 생성/수정/삭제',    'contact'),
    ('user-group:manage', '공유 사용자 그룹(조직도) 관리', 'user-group');

-- ADMIN 에 전체 부여 (V2 의 일괄 부여는 V2 시점 권한만 커버하므로 신규 권한은 명시 부여)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('contact:read', 'contact:write', 'user-group:manage');

-- USER 에 연락처 조회 부여 (모든 구성원이 디렉토리 조회 가능)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.name = 'USER' AND p.code = 'contact:read';

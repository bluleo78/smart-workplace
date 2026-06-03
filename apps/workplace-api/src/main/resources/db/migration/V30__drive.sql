-- 드라이브 도메인 첫 슬라이스 — Space/멤버/폴더/파일
-- 공간: 개인(PERSONAL, 유저당 1개) / 팀(TEAM, 독립). 권한은 drive_space_member 자족.

CREATE TABLE drive_space (
  id         BIGSERIAL PRIMARY KEY,
  type       VARCHAR(16)  NOT NULL,                 -- PERSONAL | TEAM
  name       VARCHAR(255) NOT NULL,
  owner_id   BIGINT       NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- 개인 공간은 유저당 1개만
CREATE UNIQUE INDEX uq_drive_space_personal_owner
  ON drive_space(owner_id) WHERE type = 'PERSONAL';

CREATE TABLE drive_space_member (
  space_id   BIGINT      NOT NULL REFERENCES drive_space(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES "user"(id),
  role       VARCHAR(16) NOT NULL,                  -- OWNER | EDITOR | VIEWER
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (space_id, user_id)
);

CREATE TABLE drive_folder (
  id         BIGSERIAL PRIMARY KEY,
  space_id   BIGINT       NOT NULL REFERENCES drive_space(id) ON DELETE CASCADE,
  parent_id  BIGINT       REFERENCES drive_folder(id) ON DELETE CASCADE,  -- NULL = 공간 루트
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- 같은 폴더 내 동일 이름 금지(루트는 parent_id NULL → COALESCE 0)
CREATE UNIQUE INDEX uq_drive_folder_name
  ON drive_folder(space_id, COALESCE(parent_id, 0), name);

CREATE TABLE drive_file (
  id         BIGSERIAL PRIMARY KEY,
  space_id   BIGINT       NOT NULL REFERENCES drive_space(id) ON DELETE CASCADE,
  folder_id  BIGINT       REFERENCES drive_folder(id) ON DELETE CASCADE,   -- NULL = 공간 루트
  file_id    BIGINT       NOT NULL REFERENCES file(id),
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drive_file_folder ON drive_file(space_id, folder_id);

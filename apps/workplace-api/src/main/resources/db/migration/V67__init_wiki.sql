-- 위키 도메인 첫 슬라이스 — Space/멤버/페이지(중첩 트리)/리비전.
-- 공간: 개인(PERSONAL, 테넌트별 유저당 1개) / 팀(TEAM, 독립). 권한은 wiki_space_member 자족(Drive 패턴).
-- 신규 테이블이라 tenant_id 는 생성 시 바로 NOT NULL + DEFAULT(GUC). 백필 불필요. RLS 는 V68.

CREATE TABLE wiki_space (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  type       VARCHAR(16)  NOT NULL,                 -- PERSONAL | TEAM
  name       VARCHAR(255) NOT NULL,
  owner_id   BIGINT       NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wiki_space_tenant ON wiki_space(tenant_id);
-- 개인 공간은 테넌트별 유저당 1개(유니크 인덱스는 RLS 우회 → tenant_id 포함 필수).
CREATE UNIQUE INDEX uq_wiki_space_personal_owner
  ON wiki_space(tenant_id, owner_id) WHERE type = 'PERSONAL';

CREATE TABLE wiki_space_member (
  tenant_id  BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                         REFERENCES tenant(id),
  space_id   BIGINT      NOT NULL REFERENCES wiki_space(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES "user"(id),
  role       VARCHAR(16) NOT NULL,                  -- OWNER | EDITOR | VIEWER
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX idx_wiki_space_member_tenant ON wiki_space_member(tenant_id);

CREATE TABLE wiki_page (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  space_id   BIGINT       NOT NULL REFERENCES wiki_space(id) ON DELETE CASCADE,
  parent_id  BIGINT       REFERENCES wiki_page(id) ON DELETE CASCADE,  -- NULL = 공간 루트
  title      VARCHAR(255) NOT NULL,
  body       TEXT         NOT NULL DEFAULT '',       -- 마크다운
  position   INT          NOT NULL DEFAULT 0,        -- 형제 간 정렬
  version    INT          NOT NULL DEFAULT 1,        -- 낙관적 동시성
  updated_by BIGINT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wiki_page_tenant ON wiki_page(tenant_id);
CREATE INDEX idx_wiki_page_tree ON wiki_page(space_id, parent_id, position);

CREATE TABLE wiki_revision (
  tenant_id  BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  page_id    BIGINT       NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  version    INT          NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       TEXT         NOT NULL,
  author_id  BIGINT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (page_id, version)
);
CREATE INDEX idx_wiki_revision_tenant ON wiki_revision(tenant_id);

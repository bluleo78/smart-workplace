-- V214 (WP-887, WP-882 웨이브 3): 이슈 관계 유형·관계·외부 링크.
--
-- 이슈 사이 관계를 「차단」 하나에서 관련·중복·복제·원인과 관리자가 정의하는 유형으로 넓히고,
-- 다른 시스템에 남는 이슈(Jira 등)를 외부 링크로 붙인다. 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- 1) issue_relation_type — 워크스페이스 범위 관계 유형. 기본 6개는 code 로 식별(BLOCKS·RELATES·DUPLICATES·CLONES·CAUSES·
--    PARENT_EPIC)하고 이 마이그레이션이 모든 기존 워크스페이스에 넣는다. 새 워크스페이스는 TenantProvisioningService 가
--    넣는다. 값은 IssueRelationBuiltIns.ALL 과 같아야 한다(IssueRelationSchemaTest 가 대조).
--    BLOCKS 도 행으로 두지만 저장은 issue_dependency 그대로다 — 관계 행(issue_relation)이 BLOCKS 를 가리키는 일은 없다(서비스가 막음).
-- 2) issue_relation — 두 이슈 사이 한 줄. 방향 있으면 source 가 A 쪽. 방향 없는 유형의 정규화(source < target)는 서비스가 한다.
-- 3) issue_external_link — 이슈에 붙는 외부 URL 링크. 서버는 URL 을 가져가지 않는다.
-- 4) 권한 issue_relation_type:manage — 기존 시스템 ADMIN 역할에 부여(V138 패턴). 신규 테넌트는 TenantProvisioningService 가
--    ADMIN 에 전체 권한(grantAllPermissions)을 주므로 자동 포함된다.
--
-- 세 테이블 모두 V89 의 테넌트 패턴(tenant_id 기본값 GUC, FK·인덱스, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
-- app_tenant 런타임 롤 권한은 V44 의 ALTER DEFAULT PRIVILEGES 로 자동 부여된다.

-- ── 1) 관계 유형 ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE issue_relation_type (
  id             BIGSERIAL    PRIMARY KEY,
  tenant_id      BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  code           VARCHAR(30),                                  -- 기본 유형만(사용자 정의는 NULL)
  name           VARCHAR(30)  NOT NULL,
  directed       BOOLEAN      NOT NULL,
  outward_label  VARCHAR(30)  NOT NULL,                        -- A 쪽 말(「이 이슈는 ___」)
  inward_label   VARCHAR(30),                                  -- B 쪽 말 — 방향 없는 유형은 NULL
  external_only  BOOLEAN      NOT NULL DEFAULT false,          -- 외부 링크에만 쓰는 유형(PARENT_EPIC)
  hidden         BOOLEAN      NOT NULL DEFAULT false,          -- 숨기면 새로 걸 수 없고 이미 걸린 건 그대로 보인다
  sort_order     INTEGER      NOT NULL DEFAULT 1000,           -- 기본 10~60, 사용자 정의 1000
  created_by     BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_issue_relation_type_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_issue_relation_type_tenant ON issue_relation_type(tenant_id);
-- 코드는 워크스페이스 안 유일(기본 유형만 코드가 있다). 이름은 대소문자 무시 유일(기본 유형 이름 포함).
CREATE UNIQUE INDEX uq_issue_relation_type_code ON issue_relation_type(tenant_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX uq_issue_relation_type_name ON issue_relation_type(tenant_id, lower(name));

ALTER TABLE issue_relation_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_relation_type FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_relation_type_tenant_isolation ON issue_relation_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ── 2) 관계 ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE issue_relation (
  id               BIGSERIAL    PRIMARY KEY,
  tenant_id        BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  type_id          BIGINT       NOT NULL REFERENCES issue_relation_type(id) ON DELETE RESTRICT,
  source_issue_id  BIGINT       NOT NULL REFERENCES issue(id) ON DELETE CASCADE,   -- A 쪽
  target_issue_id  BIGINT       NOT NULL REFERENCES issue(id) ON DELETE CASCADE,   -- B 쪽
  created_by       BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_issue_relation_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT uq_issue_relation UNIQUE (type_id, source_issue_id, target_issue_id),
  CONSTRAINT ck_issue_relation_not_self CHECK (source_issue_id <> target_issue_id)
);
CREATE INDEX idx_issue_relation_tenant ON issue_relation(tenant_id);
CREATE INDEX idx_issue_relation_source ON issue_relation(source_issue_id);
CREATE INDEX idx_issue_relation_target ON issue_relation(target_issue_id);
-- (type_id 기준 조회는 uq_issue_relation 의 앞 컬럼이 받쳐 주므로 별도 인덱스를 두지 않는다.)

ALTER TABLE issue_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_relation FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_relation_tenant_isolation ON issue_relation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ── 3) 외부 링크 ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE issue_external_link (
  id               BIGSERIAL     PRIMARY KEY,
  tenant_id        BIGINT        NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  issue_id         BIGINT        NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  type_id          BIGINT        NOT NULL REFERENCES issue_relation_type(id) ON DELETE RESTRICT,
  issue_is_source  BOOLEAN       NOT NULL,                    -- 방향 있는 유형에서 이 이슈가 A 쪽인가
  url              VARCHAR(2000) NOT NULL,
  ext_key          VARCHAR(50),                              -- 상대 시스템의 키(선택)
  title            VARCHAR(300)  NOT NULL,
  created_by       BIGINT        REFERENCES "user"(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT fk_issue_external_link_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT uq_issue_external_link UNIQUE (issue_id, url)
);
CREATE INDEX idx_issue_external_link_tenant ON issue_external_link(tenant_id);
CREATE INDEX idx_issue_external_link_issue ON issue_external_link(issue_id);
-- 유형 삭제 때 사용 건수 조회·이동에 쓴다(type_id RESTRICT 의 검사 경로이기도 하다).
CREATE INDEX idx_issue_external_link_type ON issue_external_link(type_id);

ALTER TABLE issue_external_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_external_link FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_external_link_tenant_isolation ON issue_external_link
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ── 기본 유형 시드 — 모든 기존 워크스페이스에 6행(IssueRelationBuiltIns.ALL 과 같은 값) ──────────────
-- tenant 는 RLS 비대상, Flyway 소유자 롤은 BYPASSRLS 라 tenant_id 를 명시해 넣는다.
INSERT INTO issue_relation_type
  (tenant_id, code, name, directed, outward_label, inward_label, external_only, sort_order)
SELECT t.id, b.code, b.name, b.directed, b.outward_label, b.inward_label, b.external_only, b.sort_order
FROM tenant t
CROSS JOIN (VALUES
  ('BLOCKS',      '차단',      true,  '차단 중',     '차단됨',      false, 10),
  ('RELATES',     '관련',      false, '관련',        NULL,          false, 20),
  ('DUPLICATES',  '중복',      true,  '중복임',      '원본임',      false, 30),
  ('CLONES',      '복제',      true,  '복제본임',    '복제 원본임', false, 40),
  ('CAUSES',      '원인',      true,  '원인임',      '결과임',      false, 50),
  ('PARENT_EPIC', '상위 에픽', true,  '에픽에 속함', NULL,          true,  60)
) AS b(code, name, directed, outward_label, inward_label, external_only, sort_order);

-- ── 4) 권한 issue_relation_type:manage — 기존 시스템 ADMIN 역할에 부여(V138 패턴) ────────────────
INSERT INTO permission (code, description, category)
VALUES ('issue_relation_type:manage', '이슈 관계 유형 관리', 'issue')
ON CONFLICT (code) DO NOTHING;

-- role/role_permission 은 RLS ENABLE(미-FORCE) — Flyway 소유자 롤은 BYPASSRLS. tenant_id 는 role 에서 가져와 명시(V132 패턴).
INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code = 'issue_relation_type:manage'
WHERE r.name = 'ADMIN'
  AND r.is_system = true
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

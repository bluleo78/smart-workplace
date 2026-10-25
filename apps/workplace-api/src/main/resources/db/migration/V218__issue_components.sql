-- V218 (WP-933, WP-882 웨이브 4): 구성요소(프로젝트 안의 제품 영역·모듈 분류).
--
-- 프로젝트마다 구성요소를 정의하고(이름·설명·기본 담당자·보관), 이슈에 여러 개를 붙인다. 이슈를 만들 때 담당자를 비워 두면
-- 구성요소의 기본 담당자가 자동 지정된다(서비스가 처리). 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- 1) project_component — 프로젝트 범위 구성요소. 이름은 프로젝트 안에서 대소문자 무시 유일(앞뒤 공백 제거는 서비스가 한다).
--    기본 담당자·생성자는 사용자가 지워져도 구성요소는 남도록 SET NULL. 보관(archived_at)하면 새로 붙일 수 없고 이미 붙은 건 그대로다.
-- 2) issue_component — 이슈↔구성요소 연결(다대다). 이슈나 구성요소가 지워지면 연결도 함께 지운다.
--
-- 두 테이블 모두 V89 의 테넌트 패턴(tenant_id 기본값 GUC, FK·인덱스, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
-- app_tenant 런타임 롤 권한은 V44 의 ALTER DEFAULT PRIVILEGES 로 자동 부여된다.

-- ── 1) 구성요소 ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE project_component (
  id                  BIGSERIAL    PRIMARY KEY,
  tenant_id           BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  project_id          BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name                VARCHAR(40)  NOT NULL,
  description         VARCHAR(200),
  default_assignee_id BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,   -- 자동 지정에 쓰는 담당자(사람만 — 서비스가 검증)
  archived_at         TIMESTAMPTZ,                                              -- 보관 시각(NULL = 사용 중)
  created_by          BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_component_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT ck_project_component_name_len CHECK (char_length(name) BETWEEN 1 AND 40)
);
CREATE INDEX idx_project_component_tenant ON project_component(tenant_id);
-- 프로젝트 안 이름 유일(대소문자 무시) — 프로젝트별 목록 조회(project_id 앞 컬럼)도 이 인덱스가 받친다.
CREATE UNIQUE INDEX uq_project_component_name ON project_component(project_id, lower(name));
-- 담당자가 지워질 때(SET NULL) 역방향 조회 경로.
CREATE INDEX idx_project_component_assignee ON project_component(default_assignee_id) WHERE default_assignee_id IS NOT NULL;

ALTER TABLE project_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_component FORCE ROW LEVEL SECURITY;
CREATE POLICY project_component_tenant_isolation ON project_component
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ── 2) 이슈 ↔ 구성요소 ────────────────────────────────────────────────────────────────────────
CREATE TABLE issue_component (
  issue_id      BIGINT       NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  component_id  BIGINT       NOT NULL REFERENCES project_component(id) ON DELETE CASCADE,
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, component_id),
  CONSTRAINT fk_issue_component_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_issue_component_tenant ON issue_component(tenant_id);
-- 구성요소로 이슈를 찾는 필터와 구성요소 삭제·사용 건수 조회용(PK 는 issue_id 가 앞이라 이 방향을 못 받친다).
CREATE INDEX idx_issue_component_component ON issue_component(component_id);

ALTER TABLE issue_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_component FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_component_tenant_isolation ON issue_component
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

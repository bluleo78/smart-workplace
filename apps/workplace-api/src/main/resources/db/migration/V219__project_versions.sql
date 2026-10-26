-- V219 (WP-888, WP-882 웨이브 5): 버전(프로젝트의 릴리스 단위) — 수정 버전·영향 버전.
--
-- 프로젝트마다 버전을 정의하고(이름·설명·시작일·출시일·출시/보관 상태), 이슈에 「수정 버전(FIX)」과 「영향 버전(AFFECTS)」을
-- 각각 여러 개 붙인다. 상태는 컬럼이 아니라 시각으로 표현한다: 보관(archived_at) > 출시됨(released_at) > 미출시.
-- 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- 1) project_version — 프로젝트 범위 버전. 이름은 프로젝트 안에서 대소문자 무시 유일(앞뒤 공백 제거·NFC 는 서비스가 한다).
--    생성자는 사용자가 지워져도 버전은 남도록 SET NULL. 시작일 <= 출시일(둘 다 있을 때)은 DB 도 지킨다.
-- 2) issue_version — 이슈↔버전 연결(다대다) + 종류(FIX|AFFECTS). 같은 버전을 두 종류로 모두 붙일 수 있어 PK 에 kind 가 든다.
--    이슈나 버전이 지워지면 연결도 함께 지운다.
--
-- 두 테이블 모두 V89 의 테넌트 패턴(tenant_id 기본값 GUC, FK·인덱스, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
-- app_tenant 런타임 롤 권한은 V44 의 ALTER DEFAULT PRIVILEGES 로 자동 부여된다.

-- ── 1) 버전 ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE project_version (
  id            BIGSERIAL    PRIMARY KEY,
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  project_id    BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          VARCHAR(40)  NOT NULL,
  description   VARCHAR(500),
  start_date    DATE,                                                         -- 시작 예정일(선택)
  release_date  DATE,                                                         -- 출시 예정일(선택)
  released_at   TIMESTAMPTZ,                                                  -- 출시 처리 시각(NULL = 미출시)
  archived_at   TIMESTAMPTZ,                                                  -- 보관 시각(NULL = 사용 중)
  created_by    BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_version_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT ck_project_version_name_len CHECK (char_length(name) BETWEEN 1 AND 40),
  CONSTRAINT ck_project_version_dates CHECK (start_date IS NULL OR release_date IS NULL OR start_date <= release_date)
);
CREATE INDEX idx_project_version_tenant ON project_version(tenant_id);
-- 프로젝트 안 이름 유일(대소문자 무시) — 프로젝트별 목록 조회(project_id 앞 컬럼)도 이 인덱스가 받친다.
CREATE UNIQUE INDEX uq_project_version_name ON project_version(project_id, lower(name));

ALTER TABLE project_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_version FORCE ROW LEVEL SECURITY;
CREATE POLICY project_version_tenant_isolation ON project_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- ── 2) 이슈 ↔ 버전 ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE issue_version (
  issue_id    BIGINT       NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  version_id  BIGINT       NOT NULL REFERENCES project_version(id) ON DELETE CASCADE,
  kind        VARCHAR(10)  NOT NULL,                                          -- FIX(수정 버전) | AFFECTS(영향 버전)
  tenant_id   BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, version_id, kind),
  CONSTRAINT fk_issue_version_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT ck_issue_version_kind CHECK (kind IN ('FIX', 'AFFECTS'))
);
CREATE INDEX idx_issue_version_tenant ON issue_version(tenant_id);
-- 버전으로 이슈를 찾는 필터·진행률·사용 건수·삭제/출시 옮기기 조회용(PK 는 issue_id 가 앞이라 이 방향을 못 받친다).
CREATE INDEX idx_issue_version_version ON issue_version(version_id, kind);

ALTER TABLE issue_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_version FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_version_tenant_isolation ON issue_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

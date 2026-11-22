-- WP-1984: YAML 워크플로우 정의(workflow)와 게시본(workflow_version). 프로젝트마다 이름 붙은 정의 여러 개를 두고, 초안(draft_yaml)은 덮어쓰며
-- 게시한 버전은 번호를 붙여 쌓는다(고치지 않는다 — update 를 두지 않는다). 이 단계는 저장·검증까지이고 실행은 하지 않는다.
-- 두 표의 FK 는 서로를 가리킨다(version→workflow CASCADE, workflow.active_version_id→version SET NULL) — 어느 쪽을 먼저 지워도 막히지 않는다.
CREATE TABLE workflow (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         BIGINT       NOT NULL
                      DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                      REFERENCES tenant(id),
  project_id        BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name              TEXT         NOT NULL,
  enabled           BOOLEAN      NOT NULL DEFAULT false,
  active_version_id BIGINT,
  draft_yaml        TEXT         NOT NULL,
  draft_updated_by  BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  draft_updated_at  TIMESTAMPTZ  NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE workflow_version (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT       NOT NULL
                DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                REFERENCES tenant(id),
  workflow_id BIGINT       NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  version_no  INT          NOT NULL CHECK (version_no >= 1),
  source_yaml TEXT         NOT NULL,
  model       JSONB        NOT NULL,
  created_by  BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_workflow_version_no UNIQUE (workflow_id, version_no)
);

ALTER TABLE workflow
  ADD CONSTRAINT fk_workflow_active_version
  FOREIGN KEY (active_version_id) REFERENCES workflow_version(id) ON DELETE SET NULL;

-- 같은 프로젝트에서 이름은 대소문자 무시로 한 번만(서비스의 이름 중복 400 이 이 색인 위반을 옮긴다).
CREATE UNIQUE INDEX uq_workflow_name ON workflow (project_id, lower(name));
CREATE INDEX idx_workflow_tenant ON workflow (tenant_id);
CREATE INDEX idx_workflow_version_tenant ON workflow_version (tenant_id);
-- SET NULL FK 의 부모(버전·사용자)가 지워질 때마다 자식 표를 통째로 훑지 않도록, 값이 있는 행만 색인한다.
CREATE INDEX idx_workflow_active_version_id ON workflow (active_version_id) WHERE active_version_id IS NOT NULL;
CREATE INDEX idx_workflow_draft_updated_by ON workflow (draft_updated_by) WHERE draft_updated_by IS NOT NULL;
CREATE INDEX idx_workflow_version_created_by ON workflow_version (created_by) WHERE created_by IS NOT NULL;

COMMENT ON TABLE  workflow IS '워크플로우 정의 — 프로젝트의 이름 붙은 YAML 정의(초안 하나 + 게시 버전들)';
COMMENT ON COLUMN workflow.id IS '행 ID';
COMMENT ON COLUMN workflow.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN workflow.project_id IS '소속 프로젝트(프로젝트가 지워지면 함께 지워짐)';
COMMENT ON COLUMN workflow.name IS '정의 이름(같은 프로젝트에서 대소문자 무시로 유일)';
COMMENT ON COLUMN workflow.enabled IS '켜짐 여부(켜고 끄는 것만으로는 아무것도 실행하지 않음)';
COMMENT ON COLUMN workflow.active_version_id IS '지금 쓰는 게시 버전(없으면 NULL, 그 버전이 지워지면 NULL)';
COMMENT ON COLUMN workflow.draft_yaml IS '초안 YAML 원문(저장할 때마다 덮어씀)';
COMMENT ON COLUMN workflow.draft_updated_by IS '초안을 마지막으로 저장한 사용자(탈퇴하면 NULL)';
COMMENT ON COLUMN workflow.draft_updated_at IS '초안을 마지막으로 저장한 시각';
COMMENT ON COLUMN workflow.created_at IS '정의를 만든 시각';

COMMENT ON TABLE  workflow_version IS '워크플로우 게시 버전 — 게시 때의 YAML 원문과 해석한 모델을 고치지 않고 쌓는다';
COMMENT ON COLUMN workflow_version.id IS '행 ID';
COMMENT ON COLUMN workflow_version.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN workflow_version.workflow_id IS '소속 워크플로우 정의(정의가 지워지면 함께 지워짐)';
COMMENT ON COLUMN workflow_version.version_no IS '게시 번호(정의마다 1부터 하나씩 늘어남)';
COMMENT ON COLUMN workflow_version.source_yaml IS '게시한 YAML 원문';
COMMENT ON COLUMN workflow_version.model IS '해석한 모델(JSON — nodes·outcomes 등은 key 가 든 배열이라 순서가 보존됨)';
COMMENT ON COLUMN workflow_version.created_by IS '게시한 사용자(탈퇴하면 NULL)';
COMMENT ON COLUMN workflow_version.created_at IS '게시한 시각';

-- RLS: V324 와 같은 형(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_tenant_isolation ON workflow
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
ALTER TABLE workflow_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_version FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_version_tenant_isolation ON workflow_version
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
-- 테넌트 영구 삭제(TenantPurgePlan)가 DELETE 를 요구하므로 DELETE 도 준다. 버전을 고치지 않는 것은 저장소가 update 를 두지 않는 것으로 지킨다.
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_version TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE workflow_id_seq TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE workflow_version_id_seq TO app_tenant;

-- WP-1985: 워크플로우 실행 엔진의 실행 표. 이슈 하나에 활성 실행은 하나(부분 유일 색인), 실행은 노드 방문(node_run)·이벤트·이동 멱등 응답을 가진다.
-- 새 표만 더한다(expand 호환). 사용자 FK 는 모두 SET NULL — 그래야 AI 사용자도 지울 수 있다.
CREATE TABLE workflow_run (
  id                  BIGSERIAL PRIMARY KEY,
  tenant_id           BIGINT       NOT NULL
                        DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                        REFERENCES tenant(id),
  issue_id            BIGINT       NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  workflow_version_id BIGINT       NOT NULL REFERENCES workflow_version(id),
  status              TEXT         NOT NULL
                        CHECK (status IN ('RUNNING', 'WAITING', 'SUSPENDED', 'COMPLETED', 'CANCELED')),
  current_node        TEXT,
  context             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  revision            INT          NOT NULL DEFAULT 0,
  started_by          BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ
);

CREATE TABLE node_run (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             BIGINT       NOT NULL
                          DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  run_id                BIGINT       NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  node_key              TEXT         NOT NULL,
  visit_no              INT          NOT NULL CHECK (visit_no >= 1),
  status                TEXT         NOT NULL
                          CHECK (status IN ('ACTIVE', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELED')),
  assignee_ids          BIGINT[]     NOT NULL DEFAULT '{}',
  workflow_assigned_ids BIGINT[]     NOT NULL DEFAULT '{}',
  outcome               TEXT,
  outputs               JSONB,
  comment_id            BIGINT       REFERENCES issue_comment(id) ON DELETE SET NULL,
  waiting_reason        TEXT,
  error                 TEXT,
  entered_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  left_at               TIMESTAMPTZ,
  actor_id              BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  via_return            BOOLEAN      NOT NULL DEFAULT false,
  CONSTRAINT uq_node_run_visit UNIQUE (run_id, node_key, visit_no)
);

CREATE TABLE workflow_run_event (
  id        BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT       NOT NULL
              DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
              REFERENCES tenant(id),
  run_id    BIGINT       NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  type      TEXT         NOT NULL,
  payload   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  actor_id  BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE workflow_move_idempotency (
  run_id     BIGINT       NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  key        TEXT         NOT NULL,
  tenant_id  BIGINT       NOT NULL
               DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
               REFERENCES tenant(id),
  actor_id   BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  response   JSONB        NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, key)
);

-- 이슈 하나에 활성 실행은 하나만(동시 시작의 경합을 DB 가 막는다).
CREATE UNIQUE INDEX uq_workflow_run_active_issue ON workflow_run (issue_id)
  WHERE status IN ('RUNNING', 'WAITING', 'SUSPENDED');
CREATE INDEX idx_workflow_run_version ON workflow_run (workflow_version_id, id DESC);
CREATE INDEX idx_workflow_run_issue ON workflow_run (issue_id, id DESC);
CREATE INDEX idx_workflow_run_tenant ON workflow_run (tenant_id);
CREATE INDEX idx_workflow_run_started_by ON workflow_run (started_by) WHERE started_by IS NOT NULL;
-- 실행 하나에 진행 중(ACTIVE·BLOCKED)인 노드 방문은 하나만.
CREATE UNIQUE INDEX uq_node_run_open ON node_run (run_id) WHERE status IN ('ACTIVE', 'BLOCKED');
CREATE INDEX idx_node_run_tenant ON node_run (tenant_id);
CREATE INDEX idx_node_run_comment ON node_run (comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX idx_node_run_actor ON node_run (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_workflow_run_event_run ON workflow_run_event (run_id, id);
CREATE INDEX idx_workflow_run_event_tenant ON workflow_run_event (tenant_id);
CREATE INDEX idx_workflow_run_event_actor ON workflow_run_event (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_workflow_move_idempotency_tenant ON workflow_move_idempotency (tenant_id);
CREATE INDEX idx_workflow_move_idempotency_actor ON workflow_move_idempotency (actor_id) WHERE actor_id IS NOT NULL;

COMMENT ON TABLE  workflow_run IS '워크플로우 실행 — 이슈 하나에 대한 한 번의 진행(활성 실행은 이슈당 하나)';
COMMENT ON COLUMN workflow_run.id IS '행 ID';
COMMENT ON COLUMN workflow_run.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN workflow_run.issue_id IS '실행 대상 이슈(이슈가 지워지면 함께 지워짐)';
COMMENT ON COLUMN workflow_run.workflow_version_id IS '실행에 고정한 게시 버전(나중에 게시·비활성해도 진행 중 실행은 이 버전으로 감)';
COMMENT ON COLUMN workflow_run.status IS '실행 상태(RUNNING·WAITING·SUSPENDED 는 활성, COMPLETED·CANCELED 는 끝남)';
COMMENT ON COLUMN workflow_run.current_node IS '지금 머무는 노드 key(끝났으면 NULL 일 수 있음)';
COMMENT ON COLUMN workflow_run.context IS '실행 문맥(JSON — 노드 출력 등 다음 판정에 쓰는 값)';
COMMENT ON COLUMN workflow_run.revision IS '낙관적 잠금용 번호(바뀔 때마다 1 늘어남, 시작은 0)';
COMMENT ON COLUMN workflow_run.started_by IS '실행을 시작한 사용자(탈퇴하면 NULL)';
COMMENT ON COLUMN workflow_run.started_at IS '실행을 시작한 시각';
COMMENT ON COLUMN workflow_run.ended_at IS '실행이 끝난 시각(진행 중이면 NULL)';

COMMENT ON TABLE  node_run IS '노드 방문 — 실행이 한 노드에 들어가 나올 때까지의 기록(같은 노드를 다시 방문하면 visit_no 가 늘어남)';
COMMENT ON COLUMN node_run.id IS '행 ID';
COMMENT ON COLUMN node_run.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN node_run.run_id IS '소속 실행(실행이 지워지면 함께 지워짐)';
COMMENT ON COLUMN node_run.node_key IS '정의 모델의 노드 key';
COMMENT ON COLUMN node_run.visit_no IS '이 실행에서 이 노드의 방문 번호(1부터)';
COMMENT ON COLUMN node_run.status IS '방문 상태(ACTIVE·BLOCKED 는 진행 중, COMPLETED·FAILED·CANCELED 는 끝남)';
COMMENT ON COLUMN node_run.assignee_ids IS '이 방문의 담당 사용자 ID 목록';
COMMENT ON COLUMN node_run.workflow_assigned_ids IS '그중 워크플로우가 이슈 담당에 넣은 사용자 ID 목록(사람이 넣은 담당은 제외)';
COMMENT ON COLUMN node_run.outcome IS '방문을 마치며 고른 결과 key';
COMMENT ON COLUMN node_run.outputs IS '방문을 마치며 낸 출력(JSON)';
COMMENT ON COLUMN node_run.comment_id IS '이동에 남긴 의견 댓글(댓글이 지워지면 NULL)';
COMMENT ON COLUMN node_run.waiting_reason IS '멈춘 이유(BLOCKED 일 때)';
COMMENT ON COLUMN node_run.error IS '실패 메시지(FAILED 일 때)';
COMMENT ON COLUMN node_run.entered_at IS '노드에 들어간 시각';
COMMENT ON COLUMN node_run.left_at IS '노드를 나온 시각(진행 중이면 NULL)';
COMMENT ON COLUMN node_run.actor_id IS '방문을 마치게 한 사용자(탈퇴하면 NULL)';
COMMENT ON COLUMN node_run.via_return IS '되돌림 간선으로 들어온 방문인지';

COMMENT ON TABLE  workflow_run_event IS '워크플로우 실행 이벤트 — 시작·이동·중단 등 실행에 일어난 일을 쌓는 기록';
COMMENT ON COLUMN workflow_run_event.id IS '행 ID';
COMMENT ON COLUMN workflow_run_event.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN workflow_run_event.run_id IS '소속 실행(실행이 지워지면 함께 지워짐)';
COMMENT ON COLUMN workflow_run_event.type IS '이벤트 종류';
COMMENT ON COLUMN workflow_run_event.payload IS '이벤트 내용(JSON)';
COMMENT ON COLUMN workflow_run_event.actor_id IS '일으킨 사용자(탈퇴하면 NULL)';
COMMENT ON COLUMN workflow_run_event.at IS '일어난 시각';

COMMENT ON TABLE  workflow_move_idempotency IS '이동 멱등 기록 — 같은 실행·같은 key 의 재시도에 첫 응답을 그대로 돌려주려고 저장';
COMMENT ON COLUMN workflow_move_idempotency.run_id IS '소속 실행(실행이 지워지면 함께 지워짐)';
COMMENT ON COLUMN workflow_move_idempotency.key IS '호출자가 만든 멱등 key(실행 안에서 유일)';
COMMENT ON COLUMN workflow_move_idempotency.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN workflow_move_idempotency.actor_id IS '첫 요청자(탈퇴하면 NULL)';
COMMENT ON COLUMN workflow_move_idempotency.response IS '저장한 첫 응답(JSON)';
COMMENT ON COLUMN workflow_move_idempotency.created_at IS '저장한 시각';

-- RLS: V332 와 같은 형(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE workflow_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_run_tenant_isolation ON workflow_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
ALTER TABLE node_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_run FORCE ROW LEVEL SECURITY;
CREATE POLICY node_run_tenant_isolation ON node_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
ALTER TABLE workflow_run_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_event FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_run_event_tenant_isolation ON workflow_run_event
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
ALTER TABLE workflow_move_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_move_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_move_idempotency_tenant_isolation ON workflow_move_idempotency
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 테넌트 영구 삭제(TenantPurgePlan)가 DELETE 를 요구하므로 DELETE 도 준다.
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_run TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON node_run TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_run_event TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_move_idempotency TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE workflow_run_id_seq TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE node_run_id_seq TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE workflow_run_event_id_seq TO app_tenant;

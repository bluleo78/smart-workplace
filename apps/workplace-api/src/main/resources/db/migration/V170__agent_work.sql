-- WP-377: AI 작업 기록. AI 구성원(①)·사람이 AI 도구로(②) 이슈를 작업하는 것을 한 모델로 저장한다.
-- (이슈, 작업자) 당 진행 중 1건(부분 유니크). 끝난 행은 지우지 않는다(이력·후속 "끝난 작업 모아 보기").
CREATE TABLE agent_work (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    BIGINT      NOT NULL
                 DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                 REFERENCES tenant(id),
  issue_id     BIGINT      NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  worker_id    BIGINT      NOT NULL REFERENCES "user"(id),
  tool         VARCHAR(40) NOT NULL,
  state        VARCHAR(16) NOT NULL DEFAULT 'WORKING'
                 CHECK (state IN ('WORKING','WAITING','REVIEW','BLOCKED','PAUSED')),
  note         VARCHAR(120),
  progress     SMALLINT CHECK (progress BETWEEN 0 AND 100),
  steps_done   SMALLINT,
  steps_total  SMALLINT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  CHECK ((steps_done IS NULL) = (steps_total IS NULL)),
  CHECK (steps_total IS NULL OR (steps_total > 0 AND steps_done BETWEEN 0 AND steps_total))
);
-- 진행 중 작업은 (이슈, 작업자) 당 하나 — 동시 첫 보고 경합을 DB 가 막는다.
CREATE UNIQUE INDEX agent_work_active_uq ON agent_work(issue_id, worker_id) WHERE ended_at IS NULL;
-- AI 위임 목록: 작업자별 진행 중 조회.
CREATE INDEX agent_work_worker_active_idx ON agent_work(worker_id) WHERE ended_at IS NULL;
CREATE INDEX idx_agent_work_tenant ON agent_work(tenant_id);
-- RLS: V78 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE agent_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_work FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_work_tenant_isolation ON agent_work
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_work TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE agent_work_id_seq TO app_tenant;

-- 이슈 챗 질문 표시(AI 구성원이 답변 필요로 보고하며 남긴 글). 노출(DTO·SSE·UI)은 WP-373.
ALTER TABLE chat_message ADD COLUMN is_question BOOLEAN NOT NULL DEFAULT false;

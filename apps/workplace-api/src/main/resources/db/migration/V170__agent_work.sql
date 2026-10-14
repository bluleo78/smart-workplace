-- WP-377: AI 작업 기록. AI 구성원(①)·사람이 AI 도구로(②) 이슈를 작업하는 것을 한 모델로 저장한다.
-- (이슈, 작업자) 당 진행 중 1건(부분 유니크). 끝난 행은 지우지 않는다(이력·후속 "끝난 작업 모아 보기").
-- 상태 어휘는 A2A 1.0 TaskState 에 맞춘다 — 이슈 = contextId, 행 하나 = task.
--   진행(ended_at IS NULL): SUBMITTED·WORKING·INPUT_REQUIRED·AUTH_REQUIRED + 플랫폼 확장 REVIEW·BLOCKED·PAUSED
--   종료(ended_at 설정):    COMPLETED·FAILED·CANCELED·REJECTED
CREATE TABLE agent_work (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    BIGINT      NOT NULL
                 DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                 REFERENCES tenant(id),
  issue_id     BIGINT      NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  worker_id    BIGINT      NOT NULL REFERENCES "user"(id),
  -- SUBMITTED(아직 착수 전)는 어떤 도구로 일할지 몰라 NULL 허용. 착수 시 채운다.
  tool         VARCHAR(40),
  state        VARCHAR(16) NOT NULL DEFAULT 'WORKING'
                 CHECK (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','PAUSED',
                                  'COMPLETED','FAILED','CANCELED','REJECTED')),
  note         VARCHAR(120),
  progress     SMALLINT CHECK (progress BETWEEN 0 AND 100),
  steps_done   SMALLINT,
  steps_total  SMALLINT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  CHECK ((steps_done IS NULL) = (steps_total IS NULL)),
  CHECK (steps_total IS NULL OR (steps_total > 0 AND steps_done BETWEEN 0 AND steps_total)),
  -- 진행 상태 ⇔ ended_at NULL. 종료 시각과 상태가 어긋난 행을 DB 가 막는다.
  CHECK ((ended_at IS NULL) = (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','PAUSED')))
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

-- 작업 상태 변경 이력(A2A task history 대응). 행 생성·상태·note·진행률 변경·종료 때마다 저장소가 스냅샷을 남긴다(트리거 없음).
-- 작업자는 agent_work.worker_id 와 같아 중복 저장하지 않는다. 조회 API 는 아직 없다.
CREATE TABLE agent_work_event (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    BIGINT      NOT NULL
                 DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                 REFERENCES tenant(id),
  work_id      BIGINT      NOT NULL REFERENCES agent_work(id) ON DELETE CASCADE,
  state        VARCHAR(16) NOT NULL
                 CHECK (state IN ('SUBMITTED','WORKING','INPUT_REQUIRED','AUTH_REQUIRED','REVIEW','BLOCKED','PAUSED',
                                  'COMPLETED','FAILED','CANCELED','REJECTED')),
  note         VARCHAR(120),
  progress     SMALLINT,
  steps_done   SMALLINT,
  steps_total  SMALLINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_work_event_work_idx ON agent_work_event(work_id, created_at);
CREATE INDEX idx_agent_work_event_tenant ON agent_work_event(tenant_id);
ALTER TABLE agent_work_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_work_event FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_work_event_tenant_isolation ON agent_work_event
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_work_event TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE agent_work_event_id_seq TO app_tenant;

-- 이슈 챗 질문 표시(AI 구성원이 답변 필요로 보고하며 남긴 글). 노출(DTO·SSE·UI)은 WP-373.
ALTER TABLE chat_message ADD COLUMN is_question BOOLEAN NOT NULL DEFAULT false;

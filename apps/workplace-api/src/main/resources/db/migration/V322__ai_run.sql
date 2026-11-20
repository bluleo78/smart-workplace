-- WP-1827: AI 처리 기록(ai_run). 서비스(API·AI Agent·Worker 등)가 하는 AI 처리 한 건을 처리 ID(run_id) 하나당 한 행으로 모은다.
-- 같은 run_id 보고(시작·종료·재전송, 순서 뒤바뀜 포함)는 저장소 upsert 가 한 행으로 합친다.
-- 상태 순위: FAILED > SUCCEEDED·SKIPPED > RUNNING. 보존은 started_at 기준(오래된 행은 정리 작업이 지운다).
CREATE TABLE ai_run (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT       NOT NULL
                     DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                     REFERENCES tenant(id),
  run_id           UUID         NOT NULL,
  kind             VARCHAR(48)  NOT NULL,
  target_type      VARCHAR(32),
  target_id        VARCHAR(64),
  target_label     VARCHAR(200),
  actor_type       VARCHAR(8)   CHECK (actor_type IN ('AUTO','USER','AGENT')),
  actor_id         BIGINT,
  source_at        TIMESTAMPTZ,
  started_at       TIMESTAMPTZ  NOT NULL,
  ended_at         TIMESTAMPTZ,
  input_tokens     BIGINT,
  output_tokens    BIGINT,
  cache_read_tokens  BIGINT,
  cache_write_tokens BIGINT,
  model            VARCHAR(100),
  credential_label VARCHAR(100),
  status           VARCHAR(16)  NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  error_reason     VARCHAR(200),
  error_detail     TEXT,
  attempt          SMALLINT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id)
);
CREATE INDEX ai_run_tenant_started_idx ON ai_run(tenant_id, started_at DESC);
CREATE INDEX ai_run_tenant_kind_started_idx ON ai_run(tenant_id, kind, started_at DESC);
-- 보고 없음(정체) 처리 대상 조회용 — 진행 중 행만.
CREATE INDEX ai_run_running_idx ON ai_run(started_at) WHERE status = 'RUNNING';

COMMENT ON TABLE  ai_run IS 'AI 처리 기록 — 처리 ID(run_id) 하나당 한 행';
COMMENT ON COLUMN ai_run.id IS '행 ID';
COMMENT ON COLUMN ai_run.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN ai_run.run_id IS '처리 ID — 같은 값의 보고를 한 행으로 합친다';
COMMENT ON COLUMN ai_run.kind IS '처리 종류(대문자 SNAKE, 예: AI_CHAT)';
COMMENT ON COLUMN ai_run.target_type IS '처리 대상 종류(예: ISSUE)';
COMMENT ON COLUMN ai_run.target_id IS '처리 대상 식별자';
COMMENT ON COLUMN ai_run.target_label IS '처리 대상 표시 이름(200자까지, 넘치면 잘림)';
COMMENT ON COLUMN ai_run.actor_type IS '시작한 주체 종류(AUTO 자동 | USER 사용자 | AGENT AI 구성원)';
COMMENT ON COLUMN ai_run.actor_id IS '시작한 주체 사용자 ID';
COMMENT ON COLUMN ai_run.source_at IS '처리를 일으킨 원본 시각(예: 메일 수신 시각)';
COMMENT ON COLUMN ai_run.started_at IS '처리 시작 시각 — 합칠 때 더 이른 값';
COMMENT ON COLUMN ai_run.ended_at IS '처리 종료 시각(진행 중이면 NULL)';
COMMENT ON COLUMN ai_run.input_tokens IS '입력 토큰 수';
COMMENT ON COLUMN ai_run.output_tokens IS '출력 토큰 수';
COMMENT ON COLUMN ai_run.cache_read_tokens IS '캐시 읽기 토큰 수';
COMMENT ON COLUMN ai_run.cache_write_tokens IS '캐시 쓰기 토큰 수';
COMMENT ON COLUMN ai_run.model IS '사용한 모델';
COMMENT ON COLUMN ai_run.credential_label IS '사용한 자격 증명 표시 이름';
COMMENT ON COLUMN ai_run.status IS '상태(RUNNING | SUCCEEDED | FAILED | SKIPPED)';
COMMENT ON COLUMN ai_run.error_reason IS '실패·건너뜀 사유(200자까지)';
COMMENT ON COLUMN ai_run.error_detail IS '실패 상세(2000자까지)';
COMMENT ON COLUMN ai_run.attempt IS '시도 횟수(합칠 때 큰 값)';
COMMENT ON COLUMN ai_run.created_at IS '행 생성 시각';
COMMENT ON COLUMN ai_run.updated_at IS '행 마지막 갱신 시각';

-- RLS: V170 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE ai_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_run FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_run_tenant_isolation ON ai_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_run TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE ai_run_id_seq TO app_tenant;

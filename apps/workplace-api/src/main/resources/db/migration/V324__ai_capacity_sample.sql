-- WP-1830: AI 처리 용량 1분 표본(ai_capacity_sample). 「AI 현황」 화면의 시계열(슬롯 사용·대기열·계정 사용·적체)을 테넌트별 1분 간격으로 쌓는다.
-- 같은 (tenant_id, sampled_at) 은 한 행 — 잠금이 풀린 뒤 같은 분에 두 번 돌아도 insert 가 무시한다. 보관은 90일(정리 작업이 지운다).
CREATE TABLE ai_capacity_sample (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             BIGINT       NOT NULL
                          DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  sampled_at            TIMESTAMPTZ  NOT NULL,
  slot_used             INT          NOT NULL,
  slot_limit            INT          NOT NULL,
  queue_waiting         INT          NOT NULL,
  queue_oldest_wait_sec INT,
  account_usage         JSONB        NOT NULL DEFAULT '[]',
  backlog               JSONB        NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, sampled_at)
);

COMMENT ON TABLE  ai_capacity_sample IS 'AI 처리 용량 1분 표본 — 테넌트·분 하나당 한 행';
COMMENT ON COLUMN ai_capacity_sample.id IS '행 ID';
COMMENT ON COLUMN ai_capacity_sample.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN ai_capacity_sample.sampled_at IS '표본 시각(분 단위로 맞춘 값)';
COMMENT ON COLUMN ai_capacity_sample.slot_used IS '사용 중인 처리 슬롯 수';
COMMENT ON COLUMN ai_capacity_sample.slot_limit IS '처리 슬롯 한도';
COMMENT ON COLUMN ai_capacity_sample.queue_waiting IS '대기열에서 기다리는 처리 수';
COMMENT ON COLUMN ai_capacity_sample.queue_oldest_wait_sec IS '가장 오래 기다린 처리의 대기 시간(초, 대기 없으면 NULL)';
COMMENT ON COLUMN ai_capacity_sample.account_usage IS 'AI 계정별 사용 현황(JSON 배열)';
COMMENT ON COLUMN ai_capacity_sample.backlog IS '종류별 적체 건수(JSON 객체)';

-- RLS: V322 ai_run 과 같은 형(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE ai_capacity_sample ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_capacity_sample FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_capacity_sample_tenant_isolation ON ai_capacity_sample
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_capacity_sample TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE ai_capacity_sample_id_seq TO app_tenant;

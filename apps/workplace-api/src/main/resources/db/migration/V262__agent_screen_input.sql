-- V262 (WP-1277): 작업 화면에서 관리자가 AI 터미널에 친 입력 기록(agent_screen_input).
--
-- 입력을 허용한 세션에서 runner 로 넘긴 키 입력을 약 1초마다 모아 한 행으로 남긴다. data 는 UTF-8 글자 그대로이고 제어 문자는
-- \x1b 같은 표기로 바꿔 둔다(역슬래시는 \\). 세션당 1MB 까지만 남기고, 넘으면 표시 행 하나를 남긴 뒤 기록을 멈춘다(중계는 계속).
--
-- 테넌트 테이블 — V248 의 테넌트 패턴. 세션이 지워지면 입력 기록도 함께 지운다(CASCADE).

CREATE TABLE agent_screen_input (
  id          BIGSERIAL    PRIMARY KEY,
  tenant_id   BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  session_id  UUID         NOT NULL REFERENCES agent_screen_session(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  data        TEXT         NOT NULL,
  CONSTRAINT fk_agent_screen_input_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_agent_screen_input_session ON agent_screen_input(session_id, id);

ALTER TABLE agent_screen_input ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_screen_input FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_screen_input_tenant_isolation ON agent_screen_input
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

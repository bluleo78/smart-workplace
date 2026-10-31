-- V249 (WP-1247): AI 별 실행 설정과 원하는 상태(agent_runtime_setting).
--
-- 「Works 가 이 AI 를 띄운다」는 사실을 이 행의 유무로 나타낸다(행이 있으면 작업 공간 템플릿으로 실행, user.agent_runtime 은 EXTERNAL).
-- 「기본」 템플릿(서버가 바로 답함) = 행 없음 + INTERNAL — 지금 방식 그대로라 기존 데이터 이관은 없다.
-- 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- 칸 묶음
--   - 원하는 상태(관리자가 쓴다): template_name/version · location_id(NULL = 워크스페이스 기본 위치) · config · desired(RUN/STOP)
--     · apply_mode(IDLE=쉴 때 적용, NOW=지금 적용) · generation(원하는 상태가 바뀔 때마다 +1).
--   - 관찰 상태(observed_* · phase · cpu/memory · started_at · agent_*): runner·AI 가 보고한다 — 웨이브 B(WP-1250) 가 쓴다.
-- 테넌트 패턴은 V220 과 같다(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).

CREATE TABLE agent_runtime_setting (
  tenant_id            BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  agent_user_id        BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  template_name        VARCHAR(64)  NOT NULL,
  template_version     VARCHAR(32)  NOT NULL,
  -- 설정이 쓰는 위치는 지울 수 없다 — 서비스가 먼저 세어 409 로 안내하고, 이 RESTRICT 는 마지막 방어선이다.
  location_id          BIGINT       REFERENCES agent_location(id) ON DELETE RESTRICT,
  config               JSONB        NOT NULL DEFAULT '{}',
  desired              VARCHAR(8)   NOT NULL DEFAULT 'STOP' CHECK (desired IN ('RUN', 'STOP')),
  apply_mode           VARCHAR(8)   NOT NULL DEFAULT 'IDLE' CHECK (apply_mode IN ('IDLE', 'NOW')),
  generation           BIGINT       NOT NULL DEFAULT 1,
  -- 아래는 관찰 상태 — 웨이브 B 가 채운다.
  observed_generation  BIGINT,
  phase                VARCHAR(16)  CHECK (phase IN ('STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'FAILED')),
  observed_message     VARCHAR(500),
  cpu_millicores       INT,
  memory_bytes         BIGINT,
  started_at           TIMESTAMPTZ,
  observed_at          TIMESTAMPTZ,
  agent_state          VARCHAR(16)  CHECK (agent_state IN ('IDLE', 'WORKING', 'BLOCKED')),
  agent_issue_key      VARCHAR(32),
  agent_next_check_at  TIMESTAMPTZ,
  agent_reported_at    TIMESTAMPTZ,
  updated_by           BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pk_agent_runtime_setting PRIMARY KEY (tenant_id, agent_user_id),
  CONSTRAINT fk_agent_runtime_setting_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 위치별 자리 사용 수·삭제 가드·runner 의 위치별 목록이 location_id 로 찾는다.
CREATE INDEX idx_agent_runtime_setting_location ON agent_runtime_setting(location_id);
-- AI(user) 삭제 때 FK ON DELETE CASCADE 가 agent_user_id 로 행을 찾는다 — PK 는 (tenant_id, agent_user_id) 라 앞 칸이 달라 쓰지 못한다.
CREATE INDEX idx_agent_runtime_setting_agent ON agent_runtime_setting(agent_user_id);

ALTER TABLE agent_runtime_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runtime_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_runtime_setting_tenant_isolation ON agent_runtime_setting
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

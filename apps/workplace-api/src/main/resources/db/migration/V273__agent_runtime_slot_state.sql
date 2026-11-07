-- V273 (WP-1409): AI 상태 보고를 칸(work-loop 하나 — 프로젝트 키)별로 남긴다.
--
-- 왜: 한 Pod 에서 여러 프로젝트 칸을 도는 AI 는 칸마다 상태를 보고한다. 지금까지는 마지막 보고 하나가 agent_* 칸을 덮어써,
-- 칸 A 가 일하는 중에 칸 B 의 「쉬는 중」 보고로 AI 가 쉬는 중으로 보이고 미뤄 둔 교체(RESTART)가 일하는 칸을 끊었다.
-- 이제 칸별 보고를 이 테이블에 두고, 서버가 합친 값(WORKING > BLOCKED > IDLE)을 agent_runtime_setting 의 agent_* 칸에 쓴다.
--
-- 롤링 배포 호환: 새 테이블과 nullable 열만 더한다. 데이터 이관은 없다 — 옛 플러그인은 칸을 밝히지 않아 '' 칸 하나로 보고하므로
-- 합친 값 = 마지막 보고 = 지금 동작과 같다. 옛 API 인스턴스는 이 테이블을 모르고 agent_* 를 바로 덮어써도 깨지지 않는다.
-- 테넌트 패턴은 V249 와 같다(tenant_id 기본값 GUC, ENABLE+FORCE RLS, USING+WITH CHECK 정책).

CREATE TABLE agent_runtime_slot_state (
  tenant_id      BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  agent_user_id  BIGINT       NOT NULL,
  slot_key       VARCHAR(32)  NOT NULL,           -- 프로젝트 키(대문자), '' = 칸을 밝히지 않은 보고
  state          VARCHAR(16)  NOT NULL CHECK (state IN ('IDLE', 'WORKING', 'BLOCKED')),
  issue_key      VARCHAR(32),
  next_check_at  TIMESTAMPTZ,
  reported_at    TIMESTAMPTZ  NOT NULL,
  CONSTRAINT pk_agent_runtime_slot_state PRIMARY KEY (tenant_id, agent_user_id, slot_key),
  -- 실행 설정을 지우면(Works 가 더는 띄우지 않음) 칸도 함께 사라진다.
  CONSTRAINT fk_agent_runtime_slot_state_setting FOREIGN KEY (tenant_id, agent_user_id)
    REFERENCES agent_runtime_setting(tenant_id, agent_user_id) ON DELETE CASCADE
);

-- 합친 현재 이슈 목록(칸 키 순, 중복 제외). 기존 agent_issue_key 는 이 목록의 첫 키로 계속 채운다(옛 화면·옛 인스턴스 호환).
ALTER TABLE agent_runtime_setting ADD COLUMN agent_issue_keys TEXT[];

COMMENT ON TABLE agent_runtime_slot_state IS
  'AI 상태 보고의 칸(work-loop 하나 — 프로젝트 키)별 마지막 값(WP-1409). 서버가 합쳐 agent_runtime_setting.agent_* 에 쓴다.';
COMMENT ON COLUMN agent_runtime_setting.agent_issue_keys IS
  '칸별 보고를 합친 현재 이슈 키 목록(WORKING·BLOCKED 칸, 칸 키 순, 중복 제외) — WP-1409';

ALTER TABLE agent_runtime_slot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runtime_slot_state FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_runtime_slot_state_tenant_isolation ON agent_runtime_slot_state
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

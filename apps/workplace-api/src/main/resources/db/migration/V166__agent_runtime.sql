-- WP-371: AI 에이전트 실행 방식.
--  INTERNAL = 서버의 ai-agent 서비스가 Claude 로 대신 실행(기존 동작, 기본값)
--  EXTERNAL = 외부 에이전트(예: 개인 PC 의 Claude Code)가 에이전트 API 키로 직접 일한다 — 서버는 이벤트를 ai-agent 로 보내지 않는다.
-- expand 단계: NOT NULL DEFAULT 'INTERNAL' 이라 구 버전 코드(컬럼을 모름)도 그대로 동작한다. HUMAN 행도 기본값을 갖지만 의미는 AGENT 에만 있다.
ALTER TABLE "user"
  ADD COLUMN agent_runtime VARCHAR(16) NOT NULL DEFAULT 'INTERNAL',
  ADD CONSTRAINT chk_user_agent_runtime CHECK (agent_runtime IN ('INTERNAL', 'EXTERNAL'));

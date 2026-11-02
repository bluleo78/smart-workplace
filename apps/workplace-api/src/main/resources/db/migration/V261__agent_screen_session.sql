-- V261 (WP-1277): 관리자가 연 AI 작업 화면(agent_screen_session) 기록.
--
-- 관리자 화면에서 실행 중인 AI 의 터미널(tmux)을 보는 세션 하나가 한 행이다. 중계 자체는 API 메모리에서 하고(한 대 전제 — docs/ops/multi-instance.md),
-- 이 표는 「누가 언제 어떤 AI 의 화면을 열고, 언제 입력을 허용했고, 왜 닫혔는지」를 남기는 감사 기록이다. 새 테이블만 더한다(롤링 배포 호환).
--
-- 테넌트 테이블 — V248(agent_location)의 테넌트 패턴(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
--   - id: 서버가 만든 UUID — runner 가 붙는 주소(/runner/screen/{id})에 실리므로 추측할 수 없는 값.
--   - location_id: 연 순간의 실제 실행 위치(기본 해석 뒤). runner 가 붙을 때 자기 위치와 같은지 견준다.
--     위치를 지워도 기록은 남도록 ON DELETE SET NULL(RESTRICT 면 위치 삭제가 FK 오류가 된다).
--   - opened_by·input_enabled_by: 사람이 지워져도 기록은 남게 SET NULL.
--   - input_enabled_at/by: 마지막으로 입력을 허용한 때·사람(입력을 다시 끄더라도 지우지 않는다 — 허용한 적이 있다는 기록).
--   - closed_at·close_reason: 닫힌 때와 까닭(한국어). 열린 세션 수는 API 메모리가 센다 — 재시작으로 남은 열린 행이 자리를 막지 않게.

CREATE TABLE agent_screen_session (
  id               UUID         PRIMARY KEY,
  tenant_id        BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  agent_user_id    BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  location_id      BIGINT       REFERENCES agent_location(id) ON DELETE SET NULL,
  opened_by        BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  opened_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  close_reason     VARCHAR(200),
  input_enabled_at TIMESTAMPTZ,
  input_enabled_by BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT fk_agent_screen_session_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_agent_screen_session_agent ON agent_screen_session(agent_user_id, opened_at DESC);
CREATE INDEX idx_agent_screen_session_location ON agent_screen_session(location_id);

ALTER TABLE agent_screen_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_screen_session FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_screen_session_tenant_isolation ON agent_screen_session
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- WP-1978 AI 작업 화면 공유 경로 표 — 여러 api 파드가 같은 화면(세션)의 주인 파드·접속 표·입력 중 상태·상한 판정을
-- 같은 곳에서 보게 한다. 브라우저 핸드셰이크는 테넌트 컨텍스트 없이 접속 표로만 인증하므로 테넌트를 모르는 채 찾아야 해
-- 전역 표(RLS 없음)로 두고 runtime 롤(app_tenant)에 읽기·쓰기를 부여한다(V336 streaming_generation 과 같은 패턴).
-- 수명이 짧고(세션이 닫히면 삭제) 파드가 죽어 남은 행은 lease_until 이 지나면 판정에서 빠져 FK 는 두지 않는다.
CREATE TABLE agent_screen_route (
  session_id        UUID         PRIMARY KEY,
  tenant_id         BIGINT       NOT NULL,
  agent_user_id     BIGINT       NOT NULL,
  location_id       BIGINT       NOT NULL,
  opened_by         BIGINT       NOT NULL,
  owner_pod_id      VARCHAR(64)  NOT NULL,
  owner_addr        VARCHAR(255) NOT NULL,
  ticket_hash       VARCHAR(64)  UNIQUE,
  ticket_expires_at TIMESTAMPTZ,
  input_holder      BOOLEAN      NOT NULL DEFAULT false,
  lease_until       TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_agent_screen_route_agent ON agent_screen_route (tenant_id, agent_user_id);

COMMENT ON TABLE  agent_screen_route IS 'AI 작업 화면 공유 경로 — 파드 사이 공유되는 화면의 주인 파드·접속 표·입력 중 상태(상한·입력 판정)';
COMMENT ON COLUMN agent_screen_route.session_id IS 'agent_screen_session.id 와 같은 값(FK 없음 — 전역·단명 표)';
COMMENT ON COLUMN agent_screen_route.tenant_id IS '화면이 속한 테넌트';
COMMENT ON COLUMN agent_screen_route.agent_user_id IS '화면의 대상 AI 사용자 — 상한·입력 판정 단위';
COMMENT ON COLUMN agent_screen_route.location_id IS 'runner 위치 — runner 소켓 견주기에 쓴다';
COMMENT ON COLUMN agent_screen_route.opened_by IS '화면을 연 관리자';
COMMENT ON COLUMN agent_screen_route.owner_pod_id IS '중계(메모리 Pair)를 가진 파드 — 예약(POST)을 받은 파드';
COMMENT ON COLUMN agent_screen_route.owner_addr IS '주인 파드에 내부 WebSocket 을 열 주소(host:port)';
COMMENT ON COLUMN agent_screen_route.ticket_hash IS '접속 표 SHA-256 — 한 번 쓰면 NULL';
COMMENT ON COLUMN agent_screen_route.ticket_expires_at IS '접속 표 만료 시각';
COMMENT ON COLUMN agent_screen_route.input_holder IS 'runner 가 입력을 켰다고 확인한 화면 여부';
COMMENT ON COLUMN agent_screen_route.lease_until IS '살아 있는 기한 — 주인 파드가 갱신하고, 지나면 어느 판정에도 세지 않으며 다음 예약 때 지운다';

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_screen_route TO app_tenant;

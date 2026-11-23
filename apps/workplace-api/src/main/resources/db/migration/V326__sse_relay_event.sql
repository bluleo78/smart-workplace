-- WP-1973 파드 사이 SSE 중계의 아웃박스 — PostgreSQL NOTIFY 페이로드 상한(8000 바이트)을 넘는 큰 이벤트는
-- 행으로 남기고 통지에는 id 만 "#id" 로 실어 보낸다(수신 파드가 id 로 되읽는다). 작은 페이로드는 이 표를 거치지 않는다.
-- 전역 행(테넌트를 가로지름)이라 RLS 를 걸지 않고, runtime 롤(app_tenant)에만 읽기·삭제·삽입을 부여한다.
CREATE TABLE sse_relay_event (
  id         BIGSERIAL   PRIMARY KEY,
  payload    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  sse_relay_event IS 'SSE 파드 사이 중계 아웃박스 — 7000 바이트를 넘는 페이로드를 행으로 남긴다';
COMMENT ON COLUMN sse_relay_event.id IS '행 ID — NOTIFY 에는 이 id 만 "#id" 로 간다';
COMMENT ON COLUMN sse_relay_event.payload IS 'RelayMessage.encode() 가 만든 중계 JSON';
COMMENT ON COLUMN sse_relay_event.created_at IS '행 생성 시각 — 정리 작업이 이 값으로 오래된 행을 지운다';

GRANT SELECT, INSERT, DELETE ON sse_relay_event TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE sse_relay_event_id_seq TO app_tenant;
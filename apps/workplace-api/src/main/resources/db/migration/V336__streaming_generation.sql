-- WP-1974 AI 생성 슬롯(진행 중 생성)을 파드 사이에 공유하는 표 — 여러 api 파드가 같은 소유자의
-- BUSY(같은 대상 중복)·LIMIT(동시 상한) 판정과 취소 소유자 검증에 같은 상태를 보게 한다.
-- 전역 행(테넌트를 가로지름)이라 RLS 를 걸지 않고, runtime 롤(app_tenant)에 읽기·쓰기를 부여한다.
-- 행은 파드가 죽어도 expires_at 이 지나면 무시·정리된다(조회는 DB 시계의 now() 기준).
CREATE TABLE streaming_generation (
  correlation_id VARCHAR(64)  PRIMARY KEY,
  owner_user_id  BIGINT       NOT NULL,
  scope          VARCHAR(32),
  gen_key        VARCHAR(255),
  pod_id         VARCHAR(64)  NOT NULL,
  started_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_streaming_generation_owner ON streaming_generation (owner_user_id, scope);

COMMENT ON TABLE  streaming_generation IS 'AI 생성 슬롯 — 파드 사이 공유되는 진행 중 생성(BUSY/LIMIT 판정·취소 소유자 검증)';
COMMENT ON COLUMN streaming_generation.correlation_id IS '생성 식별자(이벤트 봉투의 correlationId)';
COMMENT ON COLUMN streaming_generation.owner_user_id IS '생성을 시작한 사용자';
COMMENT ON COLUMN streaming_generation.scope IS '태그 도메인(예: home). 태그 없는 생성(start)은 NULL';
COMMENT ON COLUMN streaming_generation.gen_key IS '태그 대상(예: 홈 채팅 sessionId). 태그 없으면 NULL';
COMMENT ON COLUMN streaming_generation.pod_id IS '슬롯을 가진 파드 — 파드 종료 때 removeByPod 로 정리';
COMMENT ON COLUMN streaming_generation.started_at IS '시작 시각 — active 조회의 정렬 기준';
COMMENT ON COLUMN streaming_generation.expires_at IS '만료 시각 — 지나면 무시되고 다음 reserve 때 지워진다';

GRANT SELECT, INSERT, UPDATE, DELETE ON streaming_generation TO app_tenant;

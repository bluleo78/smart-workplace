-- V326: 외부 AI 연결 시각을 파드 사이에서 공유하는 표(WP-1975).
--
-- 「외부 AI 연결됨」 판정이 한 파드의 메모리(SSE 연결 map)만 보면, 다른 파드로 붙은 AI 가 끊긴 것으로 보인다.
-- 각 파드가 자기 SSE 에 붙은 AI 의 마지막 확인 시각을 이 표에 주기적으로 적고, 읽는 쪽은 이 표 하나만 본다.
--
-- AI 사용자당 한 행. 사용자 단위 글로벌(비-RLS) — V207 의 notification_setting 과 같은 범위
-- ("user" 표에 RLS 가 없고, 연결 판정은 테넌트와 무관하게 사용자 id 로만 한다).
-- app_tenant 권한은 V44 DEFAULT PRIVILEGES 로 자동 부여된다.
-- last_seen_at 은 앞으로만 간다(GREATEST) — 파드 시계가 아니라 DB now() 로 적어 파드 간 시계 차이가 없다.

CREATE TABLE agent_connection (
  user_id      BIGINT      PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE agent_connection IS 'AI 사용자별 마지막 SSE 연결 확인 시각(파드 공유, 사용자당 1행)';
COMMENT ON COLUMN agent_connection.user_id IS 'AI 사용자 id (user.id, kind=AGENT)';
COMMENT ON COLUMN agent_connection.last_seen_at IS '마지막으로 연결을 확인한 DB 시각. 앞으로만 간다(GREATEST)';

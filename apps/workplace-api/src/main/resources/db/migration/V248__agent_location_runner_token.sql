-- V248 (WP-1248): AI 실행 위치(agent_location)와 위치별 runner 토큰(agent_runner_token).
--
-- Works 가 AI 를 클러스터에서 띄우려면 「어디서」(실행 위치) 와 「그곳의 runner 가 Works 에 말을 걸 열쇠」(runner 토큰)가 필요하다.
-- 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- agent_location — 테넌트 테이블. V220 의 테넌트 패턴(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
--   - 워크스페이스에 기본 위치는 하나(부분 유니크). 첫 위치는 서비스가 기본으로 정한다.
--   - capacity = 그 위치에서 동시에 켤 수 있는 AI 수(자리).
-- agent_runner_token — runner 가 쓰는 토큰의 해시. 위치당 쓸 수 있는(회수 안 된) 토큰은 1개.

CREATE TABLE agent_location (
  id           BIGSERIAL    PRIMARY KEY,
  tenant_id    BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  name         VARCHAR(64)  NOT NULL,
  description  VARCHAR(200),
  is_default   BOOLEAN      NOT NULL DEFAULT false,
  capacity     INT          NOT NULL DEFAULT 3 CHECK (capacity BETWEEN 1 AND 100),
  created_by   BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_agent_location_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT uq_agent_location_name UNIQUE (tenant_id, name)
);
-- 워크스페이스당 기본 위치는 최대 하나 — 기본 이동은 서비스가 한 트랜잭션에서 옛 기본을 내리고 새 기본을 올린다.
CREATE UNIQUE INDEX uq_agent_location_default ON agent_location(tenant_id) WHERE is_default;

ALTER TABLE agent_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_location FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_location_tenant_isolation ON agent_location
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- runner 토큰 — RLS 를 걸지 않는다. runner 의 요청은 토큰을 확인하기 전에는 어느 테넌트인지 모르므로(테넌트 컨텍스트가 없다)
-- 테넌트 RLS 가 켜져 있으면 해시 조회 자체가 막힌다. agent_api_key(V14)·user_api_token(V117) 같은 전역 키 테이블과 같은 이유다.
-- 대신 토큰이 가리키는 tenant_id·location_id 를 검증 결과로 돌려줘 이후 요청을 그 테넌트·위치에 묶는다.
-- 평문은 저장하지 않고 SHA-256 hex 만 둔다.
CREATE TABLE agent_runner_token (
  id            BIGSERIAL    PRIMARY KEY,
  location_id   BIGINT       NOT NULL REFERENCES agent_location(id) ON DELETE CASCADE,
  tenant_id     BIGINT       NOT NULL REFERENCES tenant(id),
  token_prefix  VARCHAR(16)  NOT NULL,
  token_hash    VARCHAR(128) NOT NULL,
  created_by    BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
-- 인증 hot path — 회수되지 않은 토큰만 해시로 좁힌다.
CREATE INDEX idx_agent_runner_token_hash ON agent_runner_token(token_hash) WHERE revoked_at IS NULL;
-- 위치당 쓸 수 있는 토큰은 1개 — 재발급은 옛 토큰을 회수한 뒤 새로 넣는다.
CREATE UNIQUE INDEX uq_agent_runner_token_active ON agent_runner_token(location_id) WHERE revoked_at IS NULL;
-- 테넌트 영구 삭제가 tenant_id 로 지운다.
CREATE INDEX idx_agent_runner_token_tenant ON agent_runner_token(tenant_id);

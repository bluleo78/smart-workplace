-- WP-1685: OAuth 2.1 인가 서버 — Claude 앱 커넥터 등이 MCP 에 사용자 권한으로 붙을 수 있게 한다.
-- 순수 추가(additive) 마이그레이션. 4개 표 모두 비-RLS 글로벌 테이블(user_api_token V117 과 같은 이유):
-- 토큰 인증·토큰 엔드포인트가 테넌트 GUC 주입 전에 해시로 조회해야 하므로 RLS 를 걸 수 없다.
-- 대신 연결(oauth_connection)이 발급 시점의 테넌트에 바인딩되고, 인증 필터가 ACTIVE 멤버십과 대조한다.

-- 클라이언트 등록부: CIMD(클라이언트 ID 메타데이터 문서 URL) 캐시 또는 DCR(동적 등록) 행.
CREATE TABLE oauth_client (
  id            BIGSERIAL PRIMARY KEY,
  -- CIMD 는 메타데이터 문서 URL 그 자체, DCR 은 발급한 swc_… 식별자.
  client_id     TEXT NOT NULL UNIQUE,
  kind          VARCHAR(8) NOT NULL CHECK (kind IN ('CIMD', 'DCR')),
  client_name   TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  -- 동의 화면 표시용(있을 때만).
  logo_uri      TEXT,
  client_uri    TEXT,
  -- CIMD 캐시를 마지막으로 가져온 시각(DCR 은 NULL).
  fetched_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 정리 작업(연결 없는 오래된 DCR 삭제)이 created_at 으로 DCR 행만 고른다 — 공개 등록으로 쌓이는 DCR 만 담는 부분 인덱스.
CREATE INDEX idx_oauth_client_dcr_created ON oauth_client(created_at) WHERE kind = 'DCR';

-- 연결: (사용자, 워크스페이스, 클라이언트) 한 벌. 폐기돼도 행은 감사용으로 남는다.
CREATE TABLE oauth_connection (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id     BIGINT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  client_pk     BIGINT NOT NULL REFERENCES oauth_client(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
-- 같은 (사용자·워크스페이스·클라이언트)의 살아 있는 연결은 하나 — 동시 허용 요청도 하나로 수렴시킨다.
CREATE UNIQUE INDEX uq_oauth_connection_active
  ON oauth_connection(user_id, tenant_id, client_pk) WHERE revoked_at IS NULL;
CREATE INDEX idx_oauth_connection_user ON oauth_connection(user_id);
CREATE INDEX idx_oauth_connection_client ON oauth_connection(client_pk);
-- 테넌트 삭제(ON DELETE CASCADE)·테넌트 단위 정리가 tenant_id 로 연결을 찾는다 — 순차 스캔이 되지 않게.
CREATE INDEX idx_oauth_connection_tenant ON oauth_connection(tenant_id);

-- 인가 코드(1회용, 10분). 평문은 저장하지 않고 SHA-256 hex 만 둔다.
CREATE TABLE oauth_authorization_code (
  id             BIGSERIAL PRIMARY KEY,
  code_hash      VARCHAR(128) NOT NULL UNIQUE,
  connection_id  BIGINT NOT NULL REFERENCES oauth_connection(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  -- PKCE S256 code_challenge.
  code_challenge TEXT NOT NULL,
  resource       TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_code_connection ON oauth_authorization_code(connection_id);
CREATE INDEX idx_oauth_code_expires ON oauth_authorization_code(expires_at);

-- 액세스·리프레시 토큰. 평문은 저장하지 않고 SHA-256 hex + 표시용 앞 12자(token_prefix)만 둔다.
CREATE TABLE oauth_token (
  id             BIGSERIAL PRIMARY KEY,
  connection_id  BIGINT NOT NULL REFERENCES oauth_connection(id) ON DELETE CASCADE,
  kind           VARCHAR(8) NOT NULL CHECK (kind IN ('ACCESS', 'REFRESH')),
  -- 인증 hot path 의 해시 조회는 이 UNIQUE 인덱스를 탄다(별도 부분 인덱스는 중복이라 두지 않는다).
  token_hash     VARCHAR(128) NOT NULL UNIQUE,
  token_prefix   VARCHAR(16) NOT NULL,
  resource       TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- refresh 회전 표시(이미 쓴 refresh 의 재사용 감지에 쓴다).
  used_at        TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);
CREATE INDEX idx_oauth_token_connection ON oauth_token(connection_id);
CREATE INDEX idx_oauth_token_expires ON oauth_token(expires_at);

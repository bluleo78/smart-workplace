-- V327 (WP-1976): 프로세스 메모리에 두던 상태를 DB 로 옮기기 위한 두 테이블. 새 테이블만 더한다(expand only — 구 파드에 영향 없음).
--
-- 1) mail_oauth_state: M365 메일 연결 OAuth state. start 와 complete 가 서로 다른 파드로 가도 state 를 찾을 수 있게 한다.
--    state 원문은 저장하지 않고 SHA-256 hex 만 둔다(DB 가 새도 state 를 재사용할 수 없다). 1회 소비는 DELETE ... RETURNING.
--    user_id 에는 FK 를 걸지 않는다: 10분짜리 단명 행이라 만료 정리로 충분하다.
-- 2) genia_login_session: Gen:iA 로그인(디바이스 코드 흐름) 세션. 사용자당 한 건(UNIQUE (tenant_id, user_id)).
--    verifier·state 는 앱이 암호화해(verifier_enc·state_enc) 넣는다. 폴링 임대(poll_lease_*)로 여러 파드 중 한 곳만 폴링한다.

CREATE TABLE mail_oauth_state (
  id          BIGSERIAL    PRIMARY KEY,
  tenant_id   BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  state_hash  VARCHAR(64)  NOT NULL UNIQUE,
  user_id     BIGINT       NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_mail_oauth_state_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_mail_oauth_state_tenant_expires ON mail_oauth_state(tenant_id, expires_at);

CREATE TABLE genia_login_session (
  id                BIGSERIAL    PRIMARY KEY,
  tenant_id         BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  login_id          VARCHAR(64)  NOT NULL UNIQUE,
  user_id           BIGINT       NOT NULL,
  account_id        BIGINT,
  expected_email    TEXT,
  label             TEXT,
  verifier_enc      TEXT,
  state_enc         TEXT,
  authorize_url     TEXT         NOT NULL,
  expires_at        TIMESTAMPTZ  NOT NULL,
  interval_seconds  INT          NOT NULL,
  next_poll_at      TIMESTAMPTZ  NOT NULL,
  poll_lease_token  UUID,
  poll_lease_until  TIMESTAMPTZ,
  status            VARCHAR(16)  NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','EXPIRED','FAILED')),
  result_account_id BIGINT,
  result_email      TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_genia_login_session_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT uq_genia_login_session_tenant_user UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_genia_login_session_tenant_expires ON genia_login_session(tenant_id, expires_at);

-- RLS: V285 와 같은 모양(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE mail_oauth_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_oauth_state FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_oauth_state_tenant_isolation ON mail_oauth_state
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_oauth_state TO app_tenant;

ALTER TABLE genia_login_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE genia_login_session FORCE ROW LEVEL SECURITY;
CREATE POLICY genia_login_session_tenant_isolation ON genia_login_session
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON genia_login_session TO app_tenant;

GRANT USAGE, SELECT ON SEQUENCE mail_oauth_state_id_seq TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE genia_login_session_id_seq TO app_tenant;

COMMENT ON TABLE mail_oauth_state IS 'M365 메일 연결 OAuth state — 시작·완료가 다른 파드여도 찾도록 DB 에 둔 10분짜리 1회용 행';
COMMENT ON COLUMN mail_oauth_state.id IS '행 ID';
COMMENT ON COLUMN mail_oauth_state.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN mail_oauth_state.state_hash IS 'state 원문의 SHA-256 hex(64자) — 원문은 저장하지 않는다';
COMMENT ON COLUMN mail_oauth_state.user_id IS 'state 를 발급받은 사용자 ID(FK 없음)';
COMMENT ON COLUMN mail_oauth_state.expires_at IS '만료 시각(발급 후 10분) — 지나면 소비해도 거부';
COMMENT ON COLUMN mail_oauth_state.created_at IS '발급 시각';

COMMENT ON TABLE genia_login_session IS 'Gen:iA 로그인(디바이스 코드 흐름) 세션 — 사용자당 한 건, 여러 파드 중 임대를 잡은 곳만 폴링';
COMMENT ON COLUMN genia_login_session.id IS '행 ID';
COMMENT ON COLUMN genia_login_session.tenant_id IS '테넌트(RLS 기준, 세션 GUC 기본값)';
COMMENT ON COLUMN genia_login_session.login_id IS '로그인 세션 공개 ID(무작위, 유일) — 화면이 진행 상태를 조회할 때 쓴다';
COMMENT ON COLUMN genia_login_session.user_id IS '로그인을 시작한 사용자 ID(FK 없음)';
COMMENT ON COLUMN genia_login_session.account_id IS '다시 로그인(재인증)할 때 대상 메일 계정 ID — 새 연결이면 NULL';
COMMENT ON COLUMN genia_login_session.expected_email IS '재인증 때 기대하는 메일 주소 — 다른 계정으로 로그인하면 거부하는 기준';
COMMENT ON COLUMN genia_login_session.label IS '새로 연결할 계정에 붙일 표시 이름';
COMMENT ON COLUMN genia_login_session.verifier_enc IS 'PKCE code_verifier 를 앱이 암호화한 값(EncryptionService) — 성공·종료 후 비운다';
COMMENT ON COLUMN genia_login_session.state_enc IS 'OAuth state 를 앱이 암호화한 값 — 성공·종료 후 비운다';
COMMENT ON COLUMN genia_login_session.authorize_url IS '사용자가 열 Gen:iA 인가 URL';
COMMENT ON COLUMN genia_login_session.expires_at IS '세션 만료 시각 — 지나면 EXPIRED';
COMMENT ON COLUMN genia_login_session.interval_seconds IS '폴링 간격(초) — 서버가 slow_down 을 주면 늘어난다';
COMMENT ON COLUMN genia_login_session.next_poll_at IS '다음 폴링 가능 시각';
COMMENT ON COLUMN genia_login_session.poll_lease_token IS '폴링 임대 토큰(UUID) — 임대를 잡은 파드만 결과를 기록한다';
COMMENT ON COLUMN genia_login_session.poll_lease_until IS '폴링 임대 만료 시각 — 지나면 다른 파드가 임대를 다시 잡을 수 있다';
COMMENT ON COLUMN genia_login_session.status IS '진행 상태 PENDING(대기)·SUCCEEDED(성공)·EXPIRED(만료)·FAILED(실패)';
COMMENT ON COLUMN genia_login_session.result_account_id IS '성공 시 연결된 메일 계정 ID';
COMMENT ON COLUMN genia_login_session.result_email IS '성공 시 연결된 메일 주소';
COMMENT ON COLUMN genia_login_session.error_message IS '실패 사유(사용자에게 보여줄 수 있는 문구)';
COMMENT ON COLUMN genia_login_session.created_at IS '생성 시각';
COMMENT ON COLUMN genia_login_session.updated_at IS '마지막 갱신 시각';

-- V274 (WP-1448): AI 계정 목록 — 워크스페이스가 가진 「AI 가 쓰는 계정(키·로그인)」을 AI 와 따로 저장한다.
--
-- 지금까지는 AI 마다 ai_agent_credential 에 키·로그인을 따로 넣어, 같은 계정을 여러 AI 가 쓰려면 매번 다시 넣어야 했다.
-- 계정을 한 번 등록해 두고 여러 AI 를 묶는 구조로 바꾼다(agent_account ← agent_account_binding). 새 테이블만 더한다 —
-- 기존 테이블·행은 건드리지 않는다(롤링 배포 호환: 옛 코드는 이 테이블을 모른다). 이관 백필은 후속 작업이 한다.
--
-- 테넌트 테이블 — V272(agent_reported_model)와 같은 패턴(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
--   - encrypted_secret: EncryptionService 로 암호화한 'iv:ciphertext'. 평문은 저장하지 않는다.
--   - secret_version: 원문이 바뀔 때마다 시퀀스에서 새로 받는다 — 같은 계정을 쓰는 AI 의 Pod 교체 판단 기준.
--   - fingerprint: 원문 정체성의 SHA-256 hex(이관 백필이 같은 계정을 다시 만들지 않도록 찾는 키). NULL 허용.
--   - status: ACTIVE · NEEDS_CHECK · RELOGIN_REQUIRED. 폐기는 revoked_at 으로 표시한다.

-- secret_version 은 runner 의 claude/login 비밀값 버전으로 쓰인다. AI 가 옛 연결(ai_agent_credential — 버전 = 연결 id)에서
-- 계정으로 옮겨 갈 때 두 값이 같은 숫자면 runner 가 바뀐 줄 모르고 옛 Pod 를 그대로 둔다. 그래서 옛 연결 id 가 닿지 않을 만큼 큰 값
-- (1e12)에서 시작한다. runner(TypeScript)가 JSON 숫자로 읽으므로 2^53(약 9e15) 미만이어야 한다 — 충분히 여유가 있다.
CREATE SEQUENCE agent_account_secret_version_seq START WITH 1000000000000;

CREATE TABLE agent_account (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  provider          VARCHAR(32)  NOT NULL,
  label             VARCHAR(80)  NOT NULL,
  encrypted_secret  TEXT         NOT NULL,
  secret_version    BIGINT       NOT NULL DEFAULT nextval('agent_account_secret_version_seq'),
  account_email     VARCHAR(320),
  last_refreshed_at TIMESTAMPTZ,
  status            VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
  fingerprint       VARCHAR(64),
  created_by        BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  CONSTRAINT fk_agent_account_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);

-- 같은 워크스페이스·종류에서 살아 있는 계정의 원문 정체성은 하나 — 백필 재실행이 계정을 늘리지 않는다.
CREATE UNIQUE INDEX uq_agent_account_fingerprint
  ON agent_account(tenant_id, provider, fingerprint)
  WHERE revoked_at IS NULL AND fingerprint IS NOT NULL;
CREATE INDEX idx_agent_account_tenant ON agent_account(tenant_id) WHERE revoked_at IS NULL;

ALTER TABLE agent_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_account FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_account_tenant_isolation ON agent_account
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- AI(테넌트·agent_user_id)당 계정은 하나 — 다시 묶으면 덮어쓴다(PK). 계정 하나를 여러 AI 가 쓸 수 있다.
CREATE TABLE agent_account_binding (
  tenant_id      BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  agent_user_id  BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  account_id     BIGINT      NOT NULL REFERENCES agent_account(id),
  bound_by       BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,
  bound_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 이관 백필이 남기는 버전 이어받기: 옛 연결 id 를 runner 버전의 원천으로 계속 써서 이관된 Pod 가 다시 만들어지지 않게 한다.
  -- 계정의 secret_version 이 override_secret_version 과 같을 때만 유효하다(원문 교체 등 실제 변경이 생기면 계정 secret_version 으로 넘어간다).
  -- 백필이 아닌 묶기(관리자 묶기·기존 연결 등록·다른 계정으로 옮기기)는 둘 다 NULL 로 쓴다.
  version_id_override      BIGINT,
  override_secret_version  BIGINT,
  PRIMARY KEY (tenant_id, agent_user_id),
  CONSTRAINT fk_agent_account_binding_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_agent_account_binding_account ON agent_account_binding(account_id);

ALTER TABLE agent_account_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_account_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_account_binding_tenant_isolation ON agent_account_binding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

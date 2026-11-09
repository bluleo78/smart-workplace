-- V276 (WP-1450): ChatGPT 로그인 계정을 서버가 만료 전에 갱신한다 — 갱신 변경 표식과 갱신 시도 기록.
--
-- 롤링 배포 호환: 컬럼은 DEFAULT 가 있는 NOT NULL 추가, 테이블은 새로 더한다(옛 코드는 둘 다 모른다). V274 와 같은 RLS 정책 모양.
--   - agent_account.login_revision: 로그인 내용이 (secret_version 은 그대로인 채) 바뀔 때마다 1 씩 올린다. 서버 갱신·Pod 되가져오기가 올려
--     Pod 가 「내용만 바뀐 것」을 알고 Pod 를 갈지 않은 채 auth.json 만 받아 간다. 원문 교체(secret_version 변경)와는 별개의 축이다.
--   - agent_account_login_refresh: 계정당 갱신 시도 기록 한 행 — 중복 갱신을 막는 임대(lease_until), 마지막 시도·성공 시각, 실패 이유.
--     갱신 토큰은 1회용이라 같은 계정을 두 서버가 동시에 갱신하면 한쪽이 영구 실패한다 — 임대가 그것을 막는다.
--   - agent_account.server_refresh_ready: 서버 보관본이 신선하다고 확인돼 서버가 갱신을 맡아도 되는 계정인가. 관리자 API 로 사람이 넣은 계정·사람이 원문을
--     교체한 계정·Pod 가 더 새 로그인을 올린 계정만 true — 이관 백필 계정은 false 로 시작한다(Pod 가 이미 갱신 토큰을 돌렸을 수 있어, 서버가 낡은
--     갱신 토큰으로 갱신하면 reused 로 로그인이 죽는다). 상태(ACTIVE)와 따로 둔 이유: 다른 코드(사용량 확인 등)가 상태를 ACTIVE 로 돌려도 신선함은 보증되지 않는다.
-- 계정이 지워지면(ON DELETE CASCADE) 기록도 같이 사라진다.

ALTER TABLE agent_account ADD COLUMN login_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE agent_account ADD COLUMN server_refresh_ready BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN agent_account.server_refresh_ready IS '서버 보관본이 신선하다고 확인돼 서버가 로그인 갱신을 맡아도 되는지(사람이 넣음·교체함, Pod 가 더 새 로그인을 올림이면 true, 이관 백필은 false)';

CREATE TABLE agent_account_login_refresh (
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  account_id    BIGINT       PRIMARY KEY REFERENCES agent_account(id) ON DELETE CASCADE,
  lease_until   TIMESTAMPTZ,
  attempted_at  TIMESTAMPTZ,
  succeeded_at  TIMESTAMPTZ,
  error_code    VARCHAR(64),
  error_message VARCHAR(500),
  CONSTRAINT fk_agent_account_login_refresh_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_agent_account_login_refresh_tenant ON agent_account_login_refresh(tenant_id);

ALTER TABLE agent_account_login_refresh ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_account_login_refresh FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_account_login_refresh_tenant_isolation ON agent_account_login_refresh
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- V257 (WP-1268): AI 별·저장소 호스트별 저장소 토큰(agent_repo_credential).
--
-- 지금까지 GitHub 토큰은 실행 위치(네임스페이스) 쪽 k8s Secret 하나를 모든 AI Pod 가 함께 썼다. 이것을 Claude 연결(ai_agent_credential)처럼
-- AI 마다·호스트(github.com, gitlab.example.com …)마다 Works 에 암호화해 두고 runner 가 받아 가게 바꾼다. 새 테이블만 더한다(롤링 배포 호환).
--
-- 테넌트 테이블 — V248(agent_location)의 테넌트 패턴(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
--   - kind: GITHUB | GITLAB. host: 소문자 호스트 이름만(서비스가 정규화·검증).
--   - encrypted_token: EncryptionService(AES-GCM) 출력만. 평문은 저장하지 않는다.
--   - 폐기는 revoked_at 으로 남긴다(행은 지우지 않는다 — desired 의 repos 버전이 폐기 시각도 반영한다).
--   - 같은 AI·같은 host 의 활성 행은 하나(부분 유니크) — 교체는 옛 행을 폐기한 뒤 새로 넣는다.
--   - change_seq: 행을 넣거나 폐기할 때마다 시퀀스에서 새로 받는 번호. AI 의 repos 버전 = max(change_seq) 라 등록·교체·폐기마다
--     반드시 오른다(서버 시계·같은 밀리초에 기대지 않는다 — API 를 여러 대 띄워도 runner 가 바뀐 것을 놓치지 않게).

CREATE SEQUENCE agent_repo_credential_change_seq;

CREATE TABLE agent_repo_credential (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  agent_user_id   BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind            VARCHAR(16)  NOT NULL CHECK (kind IN ('GITHUB', 'GITLAB')),
  host            VARCHAR(253) NOT NULL,
  encrypted_token TEXT         NOT NULL,
  created_by      BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  change_seq      BIGINT       NOT NULL DEFAULT nextval('agent_repo_credential_change_seq'),
  CONSTRAINT fk_agent_repo_credential_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE UNIQUE INDEX uq_agent_repo_credential_active
  ON agent_repo_credential(tenant_id, agent_user_id, host) WHERE revoked_at IS NULL;
CREATE INDEX idx_agent_repo_credential_agent ON agent_repo_credential(agent_user_id);

ALTER TABLE agent_repo_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_repo_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_repo_credential_tenant_isolation ON agent_repo_credential
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- V65: home AI / assistant 도메인 4개 테이블에 tenant_id 컬럼 추가 + 백필 + FK.
--   대상: home_session / home_message / assistant_config / workspace_assistant
-- RLS 활성화는 V66 에서 수행 — 이 마이그레이션은 컬럼/인덱스/FK/PK 변경 만.
--
-- DEFAULT 는 V47/V61/V63 과 동일하게 백필 완료 후 추가한다:
--   Flyway 는 superuser(app)로 실행되며 GUC(app.tenant_id)가 미설정 상태이므로,
--   DEFAULT 를 먼저 붙이면 nullable->notnull 전환 시 current_setting 이 NULL 을 반환해
--   NOT NULL 위반이 발생한다. 백필 후 DEFAULT 설정 순서를 반드시 지킨다.
-- 처리 순서: home_session(루트) 를 완전히(NOT NULL 까지) 채운 뒤 →
--   home_message 가 home_session.tenant_id 를 읽어 백필한다.
--
-- 백필 정책:
--   home_session       → 상수 tenant#1 (부모는 전역 "user" 뿐인 루트 테이블 — project/role 과 동일)
--   home_message       → home_session 조인
--   assistant_config   → 상수 tenant#1
--   workspace_assistant → 상수 tenant#1 (+ 싱글톤 → 테넌트당 1개 전환, 아래 참조)

-- ============================================================
-- 1) home_session (루트: 부모는 전역 "user" 뿐 → 상수 tenant#1 백필)
--    PK(id UUID)는 전역 유일하므로 변경 불필요(안전).
-- ============================================================
ALTER TABLE home_session ADD COLUMN tenant_id BIGINT;

UPDATE home_session SET tenant_id = 1;

ALTER TABLE home_session ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE home_session ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE home_session ADD CONSTRAINT fk_home_session_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_home_session_tenant ON home_session(tenant_id);

-- ============================================================
-- 2) home_message (session_id → home_session: 부모 tenant_id 조인 백필)
--    home_session 을 NOT NULL 까지 완료한 뒤 수행해야 NULL 백필이 없다.
--    PK(id BIGSERIAL)는 변경 불필요.
-- ============================================================
ALTER TABLE home_message ADD COLUMN tenant_id BIGINT;

UPDATE home_message m SET tenant_id = s.tenant_id FROM home_session s WHERE m.session_id = s.id;

ALTER TABLE home_message ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE home_message ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE home_message ADD CONSTRAINT fk_home_message_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_home_message_tenant ON home_message(tenant_id);

-- ============================================================
-- 3) assistant_config (상수 tenant#1 백필)
--    PK(agent_user_id)는 변경하지 않는다 — 전역 AGENT user.id 를 PK 로 쓰지만,
--    한 AGENT 는 정확히 한 테넌트에 속한다는 단일-테넌트-에이전트 가정 하에 안전하다
--    (필터는 멤버십 count==1 일 때만 TenantContext 를 세팅한다). 따라서 동일 agent_user_id 가
--    여러 테넌트에 중복 등장하지 않으므로 PK 충돌이 발생하지 않는다.
-- ============================================================
ALTER TABLE assistant_config ADD COLUMN tenant_id BIGINT;

UPDATE assistant_config SET tenant_id = 1;

ALTER TABLE assistant_config ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE assistant_config ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE assistant_config ADD CONSTRAINT fk_assistant_config_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_assistant_config_tenant ON assistant_config(tenant_id);

-- ============================================================
-- 4) workspace_assistant — 싱글톤(CHECK id=1) → 테넌트당 1개 전환.
--    기존: id SMALLINT PK DEFAULT 1 + CHECK(id=1) 로 워크스페이스 전체에 단 1행만 허용.
--    변경: tenant_id 를 PK 로 삼아 "테넌트당 1행" 으로 만든다.
--    먼저 6단계로 tenant_id 를 NOT NULL 까지 채운 뒤 PK 수술을 수행한다
--    (PK 컬럼은 NOT NULL 이어야 하므로 순서가 중요).
-- ============================================================
ALTER TABLE workspace_assistant ADD COLUMN tenant_id BIGINT;

UPDATE workspace_assistant SET tenant_id = 1;

ALTER TABLE workspace_assistant ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE workspace_assistant ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE workspace_assistant ADD CONSTRAINT fk_workspace_assistant_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_workspace_assistant_tenant ON workspace_assistant(tenant_id);

-- 싱글톤 제약(CHECK id=1)과 id 단일 PK 를 제거하고, tenant_id 를 PK 로 재설정한다.
ALTER TABLE workspace_assistant DROP CONSTRAINT workspace_assistant_singleton;
ALTER TABLE workspace_assistant DROP CONSTRAINT workspace_assistant_pkey;
ALTER TABLE workspace_assistant ADD CONSTRAINT workspace_assistant_pkey PRIMARY KEY (tenant_id);

-- id 컬럼은 싱글톤 잔재 — jOOQ 재생성 회피 위해 보존(후속 정리 가능).
--   생성된 jOOQ 메타데이터가 여전히 id 를 포함하므로, 드롭하면 select* 런타임 불일치 위험이 있다.
--   id 는 DEFAULT 1 / NOT NULL 을 유지하여, id 를 생략한 INSERT 도 1 로 채워진다(테넌트 간 id=1 중복 무해).

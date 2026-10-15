-- WP-386 프로젝트·노트 스페이스·조직 공용 AI 메모리 — 공용 메모리·공간 기록·공간 지운 기록, 사용자 메시지의 공간.
-- expand only: 새 표 셋 + home_message 의 nullable 컬럼 둘. 구 파드는 새 표를 모르고, home_message 를 명시 컬럼으로만 읽고 쓴다.

-- 1) 공용 메모리 — 공간(조직·프로젝트·노트 스페이스)에 붙는다. 공간 FK 는 두지 않는다(프로젝트는 soft delete 라 읽기 경로가 거르고,
--    삭제 이벤트에서 서비스가 함께 지운다). author_user_id 는 직접 추가·요청한 사람 — 대화에서 뽑힌 항목(AI_EXTRACTED·AI_CLEANED)은
--    발화자를 남기지 않으므로 늘 NULL 이다(발화자 추적 금지). updated_by 도 AI 변경이면 NULL.
CREATE TABLE shared_ai_memory (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       BIGINT       NOT NULL
                    DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                    REFERENCES tenant(id),
  space_type      VARCHAR(16)  NOT NULL,
  space_id        BIGINT,
  content         VARCHAR(300) NOT NULL,
  origin          VARCHAR(16)  NOT NULL,
  author_user_id  BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by      BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  -- 키워드 검색(개인 메모리 V175 와 같은 'simple' 토크나이저).
  search_tv       tsvector     GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  -- BGE-M3 dense(1024) — 저장·내용 수정 커밋 뒤 비동기로 채우고, 내용이 바뀌면 같은 UPDATE 에서 NULL 로 되돌린다.
  embedding       vector(1024),
  CONSTRAINT ck_shared_ai_memory_space
    CHECK ((space_type = 'ORG' AND space_id IS NULL)
        OR (space_type IN ('PROJECT', 'WIKI_SPACE') AND space_id IS NOT NULL)),
  CONSTRAINT ck_shared_ai_memory_origin
    CHECK (origin IN ('USER_ADDED', 'USER_REQUESTED', 'AI_EXTRACTED', 'AI_CLEANED'))
);
-- 공간별 최신순 목록·주입(키셋).
CREATE INDEX shared_ai_memory_space_idx
  ON shared_ai_memory (tenant_id, space_type, space_id, updated_at DESC);
CREATE INDEX shared_ai_memory_search_tv_idx ON shared_ai_memory USING GIN (search_tv);
-- 백필(1분마다 embedding IS NULL 오래된 순 50개)용 부분 인덱스.
CREATE INDEX shared_ai_memory_embedding_pending_idx ON shared_ai_memory (id) WHERE embedding IS NULL;

ALTER TABLE shared_ai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_ai_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_ai_memory_tenant_isolation ON shared_ai_memory
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON shared_ai_memory TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE shared_ai_memory_id_seq TO app_tenant;

-- 2) 공간 기록 — 사람·AI 의 모든 변경. 90일 보관(만료 정리 배치가 지운다). run_id: 배경 정리 한 공간 묶음(세션과 무관한 새 UUID,
--    사람 변경은 NULL). actor_user_id: 사람이면 그 사람, AI 면 NULL. before: 바뀌기 전 스냅숏 배열, after: 바뀐 뒤(지움이면 NULL).
--    memory_id 는 결과(지움이면 지운) 메모리 — 메모리가 지워져도 기록은 남으므로 FK 를 두지 않는다.
CREATE TABLE shared_ai_memory_change (
  id             BIGSERIAL    PRIMARY KEY,
  tenant_id      BIGINT       NOT NULL
                   DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                   REFERENCES tenant(id),
  space_type     VARCHAR(16)  NOT NULL,
  space_id       BIGINT,
  run_id         UUID,
  action         VARCHAR(16)  NOT NULL,
  actor_user_id  BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  actor_kind     VARCHAR(8)   NOT NULL,
  memory_id      BIGINT       NOT NULL,
  before         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  after          JSONB,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  undone_at      TIMESTAMPTZ,
  undone_by      BIGINT       REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT ck_shared_ai_memory_change_action
    CHECK (action IN ('ADDED', 'UPDATED', 'DELETED', 'MERGED', 'RESTORED')),
  CONSTRAINT ck_shared_ai_memory_change_actor CHECK (actor_kind IN ('USER', 'AI'))
);
CREATE INDEX shared_ai_memory_change_space_idx
  ON shared_ai_memory_change (tenant_id, space_type, space_id, created_at DESC);
CREATE INDEX shared_ai_memory_change_created_idx ON shared_ai_memory_change (created_at);

ALTER TABLE shared_ai_memory_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_ai_memory_change FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_ai_memory_change_tenant_isolation ON shared_ai_memory_change
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON shared_ai_memory_change TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE shared_ai_memory_change_id_seq TO app_tenant;

-- 3) 공간 지운 기록 — 관리 권한자가 지운 AI 항목·되돌린 AI 추가를 배경 추출·정리가 다시 저장하지 못하게. 공간당 300행(앱이 오래된 것부터 지운다).
CREATE TABLE shared_ai_memory_forgotten (
  id          BIGSERIAL    PRIMARY KEY,
  tenant_id   BIGINT       NOT NULL
                DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                REFERENCES tenant(id),
  space_type  VARCHAR(16)  NOT NULL,
  space_id    BIGINT,
  content     VARCHAR(300) NOT NULL,
  normalized  VARCHAR(300) NOT NULL,
  embedding   vector(1024),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX shared_ai_memory_forgotten_space_idx
  ON shared_ai_memory_forgotten (tenant_id, space_type, space_id, normalized);
CREATE INDEX shared_ai_memory_forgotten_embedding_pending_idx
  ON shared_ai_memory_forgotten (id) WHERE embedding IS NULL;

ALTER TABLE shared_ai_memory_forgotten ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_ai_memory_forgotten FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_ai_memory_forgotten_tenant_isolation ON shared_ai_memory_forgotten
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON shared_ai_memory_forgotten TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE shared_ai_memory_forgotten_id_seq TO app_tenant;

-- 4) 사용자 메시지의 공간 — 서버가 권한을 확인한 화면 공간만 채운다(PROJECT·WIKI_SPACE). 배경 추출이 발화를 공간별로 묶는 근거.
ALTER TABLE home_message ADD COLUMN space_type VARCHAR(16);
ALTER TABLE home_message ADD COLUMN space_id BIGINT;

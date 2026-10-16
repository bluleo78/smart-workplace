-- WP-385 대화가 끝난 뒤 AI 가 메모리를 스스로 정리 — 사용 시각·정리 기록·지운 기록·세션 정리 경계.
-- expand only: 새 컬럼은 DEFAULT 가 있거나 nullable, 나머지는 새 표다 — 롤링 배포 중 구 파드의 insert·select 는 그대로 동작한다
-- (AiMemoryRepository 는 명시 컬럼만 고르고, 구 파드의 insert 는 last_used_at 을 DEFAULT 로 채운다).

-- 1) 메모리를 실제로 쓴 시각(대화 블록에 실림·search_memory 결과·다른 진입점). 기존 행은 마이그레이션 시각으로 채운다 — 배포 직후 30일 감쇠·
--    90일 삭제가 한꺼번에 일어나지 않게. now() 는 STABLE 이라 PG11+ 에서 테이블을 다시 쓰지 않고 기본값만 기록한다.
ALTER TABLE ai_memory ADD COLUMN last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- 감쇠 대상(AI 저장 + 고정 아님)만 담는 부분 인덱스 — 매일 90일 삭제와 사용자별 감쇠 판정이 탄다.
CREATE INDEX ai_memory_last_used_idx ON ai_memory (tenant_id, user_id, last_used_at)
  WHERE source = 'AI' AND NOT pinned;

-- 2) 「AI가 정리함」 기록 — 배경 정리·감쇠 삭제가 남기고 사용자가 항목별로 되돌린다. 30일 보관(만료 정리 배치가 지운다).
--    before: 바뀌기 전 스냅숏 배열(각 원본의 id·content·kind·scope·expiresOn·source·pinned·lastUsedAt), after: 바뀐 뒤 스냅숏(지움이면 NULL).
--    memory_id: 결과 메모리(FORGOTTEN·DECAYED 는 지운 id) — 메모리가 지워져도 기록은 남으므로 FK 를 두지 않는다.
CREATE TABLE ai_memory_change (
  id                BIGSERIAL    PRIMARY KEY,
  tenant_id         BIGINT       NOT NULL
                      DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                      REFERENCES tenant(id),
  user_id           BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  run_id            UUID         NOT NULL,
  action            VARCHAR(16)  NOT NULL,
  memory_id         BIGINT       NOT NULL,
  before            JSONB        NOT NULL DEFAULT '[]'::jsonb,
  after             JSONB,
  source_session_id UUID         REFERENCES home_session(id) ON DELETE SET NULL,
  reason            VARCHAR(200),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  undone_at         TIMESTAMPTZ,
  CONSTRAINT ck_ai_memory_change_action
    CHECK (action IN ('ADDED', 'MERGED', 'UPDATED', 'FORGOTTEN', 'DECAYED'))
);
-- 기록 목록(최신순 키셋)·30일 횟수.
CREATE INDEX ai_memory_change_user_idx ON ai_memory_change (tenant_id, user_id, created_at DESC);
-- 30일 보관 정리.
CREATE INDEX ai_memory_change_created_idx ON ai_memory_change (created_at);
-- 대화 삭제 시 SET NULL 대상 탐색 — 없으면 home_session 삭제마다 이 표 전체를 훑는다(V169 와 같은 이유).
CREATE INDEX ai_memory_change_session_idx ON ai_memory_change (source_session_id)
  WHERE source_session_id IS NOT NULL;

ALTER TABLE ai_memory_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_memory_change FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_memory_change_tenant_isolation ON ai_memory_change
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_memory_change TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE ai_memory_change_id_seq TO app_tenant;

-- 3) 지운 기록 — 사용자가 지우게 한 내용을 배경 정리가 다시 저장하지 않게 막는다. 사용자당 500행(앱이 오래된 것부터 지운다).
--    normalized: 공백·문장부호·기호를 걷고 소문자로(MemoryTextNormalizer). embedding: BGE-M3 dense(1024), 커밋 뒤·백필로 채운다.
CREATE TABLE ai_memory_forgotten (
  id          BIGSERIAL    PRIMARY KEY,
  tenant_id   BIGINT       NOT NULL
                DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                REFERENCES tenant(id),
  user_id     BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  content     VARCHAR(300) NOT NULL,
  normalized  VARCHAR(300) NOT NULL,
  embedding   vector(1024),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ai_memory_forgotten_user_idx ON ai_memory_forgotten (tenant_id, user_id, created_at DESC);
CREATE INDEX ai_memory_forgotten_normalized_idx ON ai_memory_forgotten (user_id, normalized);
-- 백필(1분마다 embedding IS NULL 오래된 순 50개)용 부분 인덱스.
CREATE INDEX ai_memory_forgotten_embedding_pending_idx ON ai_memory_forgotten (id)
  WHERE embedding IS NULL;

ALTER TABLE ai_memory_forgotten ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_memory_forgotten FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_memory_forgotten_tenant_isolation ON ai_memory_forgotten
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_memory_forgotten TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE ai_memory_forgotten_id_seq TO app_tenant;

-- 4) 세션 정리 경계 — 정리를 끝낸 마지막 메시지 id(NULL = 아직 아무것도 정리하지 않음)와 연속 실패 횟수.
ALTER TABLE home_session ADD COLUMN memory_processed_message_id BIGINT;
ALTER TABLE home_session ADD COLUMN memory_cleanup_failures SMALLINT NOT NULL DEFAULT 0;
-- 배포 직후 과거 대화 전체를 정리하지 않게 지금 세션의 마지막 메시지 id 로 채운다(메시지 없는 세션은 NULL 그대로).
-- 마커 사이 문장은 AiMemoryCleanupMigrationTest 가 그대로 읽어 다시 돌린다 — 마커를 지우거나 문장을 둘로 나누지 않는다.
-- @wp385-backfill-begin
UPDATE home_session s
   SET memory_processed_message_id = (SELECT max(m.id) FROM home_message m WHERE m.session_id = s.id);
-- @wp385-backfill-end
-- 대상 세션 선정(마지막 메시지 30분~7일 전, 오래된 순).
CREATE INDEX home_session_memory_cleanup_idx ON home_session (tenant_id, last_message_at);

-- WP-55 AI 메모리: 사용자가 대화에서 알려 준 교정·선호(PREFERENCE)와 오래 유지될 업무 맥락(CONTEXT).
-- 새 테이블 + nullable 컬럼 추가만 한다(expand only) — 롤링 배포 중 구 파드의 select/insert 는 그대로 동작한다.
-- 사용자 삭제 시 메모리도 삭제(CASCADE), 대화를 지워도 메모리는 남는다(source_session_id SET NULL).
CREATE TABLE ai_memory (
  id                BIGSERIAL    PRIMARY KEY,
  user_id           BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind              VARCHAR(16)  NOT NULL,
  content           VARCHAR(300) NOT NULL,           -- 코드포인트 300자(앱이 trim·길이 검증, 자르지 않음)
  source            VARCHAR(8)   NOT NULL,
  source_session_id UUID         REFERENCES home_session(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  tenant_id         BIGINT       NOT NULL
                      DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                      REFERENCES tenant(id),
  CONSTRAINT ck_ai_memory_kind   CHECK (kind IN ('PREFERENCE', 'CONTEXT')),
  CONSTRAINT ck_ai_memory_source CHECK (source IN ('AI', 'USER'))
);
-- 매 채팅 턴 주입·설정 목록: (tenant, user) 최신순 인덱스 1회.
CREATE INDEX ai_memory_user_idx ON ai_memory (tenant_id, user_id, updated_at DESC);
-- 대화 삭제 시 SET NULL 대상 탐색 — 없으면 home_session 삭제마다 ai_memory 전체를 훑는다.
CREATE INDEX idx_ai_memory_source_session ON ai_memory (source_session_id) WHERE source_session_id IS NOT NULL;

-- RLS: V133/V165 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
-- RLS 는 테넌트까지만 막는다 — 사용자 경계(user_id = caller)는 AiMemoryRepository 가 모든 쿼리에서 건다.
ALTER TABLE ai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_memory_tenant_isolation ON ai_memory
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_memory TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE ai_memory_id_seq TO app_tenant;

-- "user".ai_memory_enabled: 사용자별 메모리 켜기/끄기. NULL = 켜짐(ai_suggestions_enabled 와 같은 규칙).
ALTER TABLE "user" ADD COLUMN ai_memory_enabled BOOLEAN;

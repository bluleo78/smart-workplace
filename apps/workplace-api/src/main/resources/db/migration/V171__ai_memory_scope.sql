-- WP-379 AI 메모리 범위: NULL = 공통(모든 AI 대화), 아니면 앱 하나(그 앱 화면의 AI 대화에만 주입).
-- expand only — 롤링 배포 중 구 파드는 새 컬럼을 모른 채 insert(= 공통)·select 해도 된다. 기존 행은 모두 공통.
ALTER TABLE ai_memory ADD COLUMN scope VARCHAR(16);
ALTER TABLE ai_memory ADD CONSTRAINT ck_ai_memory_scope
  CHECK (scope IS NULL OR scope IN ('ISSUE', 'WIKI', 'MAIL', 'DRIVE', 'MESSAGING', 'CALENDAR'));
-- 주입·범위별 개수: (tenant, user, scope) 최신순. 기존 ai_memory_user_idx 는 롤링 배포 중 구 파드의 쿼리 계획을 위해
-- 이번엔 남긴다(다음 정리 때 제거 — 새 인덱스가 앞부분을 대체한다).
CREATE INDEX ai_memory_user_scope_idx ON ai_memory (tenant_id, user_id, scope, updated_at DESC);

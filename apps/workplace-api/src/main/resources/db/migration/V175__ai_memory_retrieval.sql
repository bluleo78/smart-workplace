-- WP-383 관련 메모리 선택 주입: 고정(pinned)·키워드 색인(search_tv)·의미 임베딩(embedding).
-- expand only — 롤링 배포 중 구 파드는 새 컬럼을 모른 채 insert(= 고정 아님·임베딩 없음)·select 해도 된다.
-- 고정: 사용자가 설정 화면에서만 켠다(AI 대행은 403). 범위마다 최대 10개는 앱이 센다(만료 행 포함).
ALTER TABLE ai_memory ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
-- 키워드: 내용의 tsvector('simple' — V95/V110 과 같은 토크나이저). GENERATED STORED 라 늘 내용과 같다.
-- ai_memory 는 사용자당 수백 행 규모라 생성 컬럼 추가의 테이블 재작성 잠금이 짧다.
ALTER TABLE ai_memory
  ADD COLUMN search_tv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;
CREATE INDEX ai_memory_search_tv_idx ON ai_memory USING GIN (search_tv);
-- 의미: BGE-M3 dense(1024 — workplace.worker.embed.dimensions 와 같다). 저장·내용 수정 커밋 뒤 비동기로 채우고,
-- 내용이 바뀌면 같은 UPDATE 에서 NULL 로 되돌린다. 사용자 필터 뒤 정확 탐색(사용자당 행이 적다)이라 벡터 인덱스는 두지 않는다.
ALTER TABLE ai_memory ADD COLUMN embedding vector(1024);
-- 백필(1분마다 embedding IS NULL 오래된 순 50개)용 부분 인덱스 — 채워진 대다수 행은 담지 않는다.
CREATE INDEX ai_memory_embedding_pending_idx ON ai_memory (id) WHERE embedding IS NULL;

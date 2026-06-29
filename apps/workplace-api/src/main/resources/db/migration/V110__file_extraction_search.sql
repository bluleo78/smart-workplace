-- Drive 콘텐츠 검색 — file_extraction 에 키워드(tsvector) + 의미(pgvector) 검색 컬럼 추가.
-- pgvector 확장 필요(이미지 pgvector/pgvector:pg16). 차원 1024 = BGE-M3 dense(설정 workplace.worker.embed.dimensions 와 일치).
-- V107 에서 생성된 file_extraction 테이블에 컬럼을 추가한다.
-- ⚠️ prod DB 유저에 superuser 또는 CREATE EXTENSION 권한 필요. 이미 vector 확장이 있으면 no-op.
CREATE EXTENSION IF NOT EXISTS vector;

-- 키워드: 추출 텍스트의 tsvector(다국어 안전 'simple' 토크나이저, V95 메일 FTS 패턴 미러). GENERATED STORED 라 항상 동기.
ALTER TABLE file_extraction
  ADD COLUMN search_tv tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(extracted_text, ''))) STORED;
CREATE INDEX ix_file_extraction_search_tv ON file_extraction USING GIN (search_tv);

-- 의미: BGE-M3 dense 임베딩(1024차원). 추출 후 워커가 채운다(임베딩 전 NULL).
ALTER TABLE file_extraction ADD COLUMN embedding vector(1024);
-- 코사인 거리(<=>) ANN. <1M 벡터 → lists=100. 임베딩 NULL 행은 인덱스에서 자연 제외.
CREATE INDEX ix_file_extraction_embedding ON file_extraction
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- WP-380 AI 메모리 기한: NULL = 기한 없음. 기한 날짜(Asia/Seoul) 당일까지 유효하고 다음 날부터 주입·한도에서 빠진다(만료 행은 목록에 남는다).
-- 기한 + 30일이 지나면 정리 배치가 지운다. expand only — 구 파드는 컬럼을 모른 채 insert(= 기한 없음)해도 된다.
ALTER TABLE ai_memory ADD COLUMN expires_on DATE;
-- 정리 배치(expires_on < 기준일)용 부분 인덱스 — 기한 없는 대다수 행은 담지 않는다.
CREATE INDEX ai_memory_expires_idx ON ai_memory (expires_on) WHERE expires_on IS NOT NULL;

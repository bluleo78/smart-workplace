-- WP-384 지난 대화 검색: 완료 답 임베딩(embedding).
-- expand only — 구 파드는 새 컬럼을 모른 채 insert·select 해도 된다(HomeMessageRepository 는 명시 컬럼만 고른다).
-- 키워드 색인은 두지 않는다 — 검색은 본인 대화로 먼저 거른 뒤 to_tsvector('simple', content) 를 행마다 계산한다
-- (생성 컬럼은 테이블 재작성, 전역 GIN 은 사용자 필터 뒤라 타지 않고 쓰기 비용만 든다 — 컨트롤러 판정 12).
-- 의미: "질문: {직전 USER}\n답: {ASSISTANT}"(2,000자)의 BGE-M3 dense(1024). 완료(COMPLETE)된 ASSISTANT 행에만 커밋 뒤·백필로 채운다.
-- 사용자 필터 뒤 정확 탐색이라 벡터 인덱스는 두지 않는다.
ALTER TABLE home_message ADD COLUMN embedding vector(1024);
-- 백필(1분마다 오래된 순 50개)용 부분 인덱스 — 채울 대상(완료 답 + 빈 임베딩)만 담는다.
CREATE INDEX home_message_embedding_pending_idx ON home_message (id)
  WHERE role = 'ASSISTANT' AND status = 'COMPLETE' AND embedding IS NULL;

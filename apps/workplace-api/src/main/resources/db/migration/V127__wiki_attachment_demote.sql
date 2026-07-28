-- #759 위키 첨부 강등(demote) 표식.
--
-- 배경: #757 이후 상한은 "본문 참조 ∪ 임시(file.expires_at IS NOT NULL)" 로 센다. 그런데 참조가 빠진 첨부를
-- 회수하려고 file.expires_at 을 다시 세우면(만료 재무장), 그 파일이 "임시" 로 되살아나 카운트에 다시 잡힌다
-- → "본문에서 지우고 저장하면 다시 올릴 수 있다"(#757 이 만든 해소 가능성)가 조용히 되돌아간다.
--
-- 그래서 "업로드 직후라 아직 승격된 적 없음(temp)" 과 "승격됐다가 참조가 빠져 유예 중(demoted)" 을 구분한다.
-- 상한 계산은 demoted_at IS NULL 인 것만 임시로 취급한다.
--
-- 승격(참조 복귀) 시 expires_at 과 함께 NULL 로 되돌린다 — 유예 중 참조가 돌아오면 무장 해제.
ALTER TABLE wiki_page_attachment ADD COLUMN demoted_at TIMESTAMPTZ;

-- 정리 스윕이 "유예가 지난 강등 첨부" 를 찾을 때 쓰는 부분 인덱스.
CREATE INDEX idx_wiki_page_attachment_demoted
  ON wiki_page_attachment(demoted_at)
  WHERE demoted_at IS NOT NULL;

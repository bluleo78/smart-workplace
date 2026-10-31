-- WP-1243: 노트 검색용 평문. 본문(마크다운 + HTML 혼합)에서 태그·페이지 스타일 CSS·HTML 블록 소스·마크다운 기호를 걷어 낸 글자만 둔다
-- (WikiPlainText). 검색은 이 열로 찾고 스니펫도 여기서 자른다 — 「div」·「style」 같은 태그 이름이 걸리지 않게.
-- 저장 때마다 API 가 함께 채운다. 기존 행은 NULL 로 두고 WikiSearchTextBackfillScheduler 가 테넌트마다 나눠 채운다 — 마크다운·HTML
-- 해석은 SQL 로 같게 만들 수 없어 Java 추출기를 쓴다. 채워지기 전(NULL)에는 검색이 본문 원문으로 찾는다(지금과 같은 동작).
-- 롤링 배포 호환(expand): NULL 허용 열 추가만 한다 — 옛 코드는 이 열을 모른 채 그대로 동작한다.
ALTER TABLE wiki_page ADD COLUMN search_text TEXT NULL;

-- 백필 대상 찾기용 부분 인덱스 — 다 채운 뒤에는 비어 있어 회차마다 도는 「NULL 인 행」 조회가 표를 훑지 않는다.
CREATE INDEX idx_wiki_page_search_text_missing ON wiki_page (id) WHERE search_text IS NULL;

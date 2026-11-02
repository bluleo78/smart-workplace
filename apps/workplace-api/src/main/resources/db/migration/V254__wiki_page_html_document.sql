-- WP-1307 노트 「HTML 문서」 페이지 — 원본 HTML 을 그대로 보관·표시하는 새 페이지 종류.
-- kind: NOTE(지금의 노트, 동시 편집 대상) / HTML(원본 HTML 문서, 동시 편집 대상 아님). 기존 페이지는 모두 NOTE.
-- html_source: HTML 문서의 원본 HTML(노트면 NULL). body 에는 원본에서 뽑은 본문 글자를 둬서 검색·요약·미리보기 등
--   body 를 읽는 기존 경로가 HTML 태그 대신 글자를 보게 한다. 크기 상한(5MB)은 API 가 지킨다.
-- wiki_revision.html_source: 그 판의 원본 HTML — 판 미리보기·되돌리기를 HTML 그대로 하기 위해.
-- 추가만 하는 컬럼(상수 DEFAULT·NULL 허용)이라 테이블을 다시 쓰지 않고, 구·신 버전이 섞여 돌아도 안전하다(expand).
ALTER TABLE wiki_page ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'NOTE';
ALTER TABLE wiki_page ADD CONSTRAINT wiki_page_kind_check CHECK (kind IN ('NOTE', 'HTML')) NOT VALID;
ALTER TABLE wiki_page VALIDATE CONSTRAINT wiki_page_kind_check;
ALTER TABLE wiki_page ADD COLUMN html_source text NULL;
ALTER TABLE wiki_revision ADD COLUMN html_source text NULL;

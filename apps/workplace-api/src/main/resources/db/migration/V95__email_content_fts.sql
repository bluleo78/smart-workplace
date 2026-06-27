-- email_content 전문검색(FTS) 컬럼 + GIN 인덱스.
-- 'simple' 토크나이저: 한국어 형태소는 범위 밖이지만 제목·본문·스니펫을 공백 단위로 색인해 영문·숫자·고유명사 검색은 가능하다.
-- GENERATED ALWAYS AS … STORED 로 자동 갱신되어 별도 트리거가 없어도 항상 최신 상태를 유지한다.
-- 인덱스 1벌(search_tv_idx)이 subject·body_text·snippet 전체를 커버하므로 별도 컬럼 인덱스가 불필요하다.
ALTER TABLE email_content
    ADD COLUMN search_tv tsvector
        GENERATED ALWAYS AS (
            to_tsvector('simple',
                coalesce(subject, '') || ' ' || coalesce(body_text, '') || ' ' || coalesce(snippet, ''))
            ) STORED;

CREATE INDEX email_content_search_tv_idx ON email_content USING GIN (search_tv);

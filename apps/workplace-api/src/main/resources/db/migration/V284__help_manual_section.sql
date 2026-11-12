-- WP-1509 도움말 검색 — 제품 매뉴얼의 절(section) 색인.
-- expand only: 새 표 하나. 구 파드는 이 표를 모른다.
-- tenant_id·RLS 를 두지 않는다: 매뉴얼은 제품 공용 문서라 테넌트마다 다르지 않고, 모든 테넌트가 같은 절을 본다.
-- 파드가 여러 개여도 같은 묶음에서 같은 행으로 수렴하므로(upsert) 중복 색인이 문제되지 않는다.
CREATE TABLE help_manual_section (
  section_id    text        PRIMARY KEY,
  chapter       text        NOT NULL,
  chapter_title text        NOT NULL,
  title         text        NOT NULL,
  label         text        NOT NULL,
  -- 이 장·절을 볼 수 있는 대상(비면 모두). 'member'·'admin' 값.
  audience      text[]      NOT NULL DEFAULT '{}',
  body          text        NOT NULL,
  -- sha256(chapterTitle|label|title|body) — 같으면 다시 임베딩하지 않는다.
  content_hash  text        NOT NULL,
  -- 묶음 안 순서(장 순서 x 1000 + 절 순서) — 같은 점수일 때 정렬용.
  ord           int         NOT NULL,
  -- BGE-M3 dense(1024) — 내용이 바뀌면 NULL 로 되돌리고 색인기가 다시 채운다.
  embedding     vector(1024),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- 임베딩 채우기용 부분 인덱스.
CREATE INDEX help_manual_section_embedding_pending_idx ON help_manual_section (ord) WHERE embedding IS NULL;

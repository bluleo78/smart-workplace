-- 드라이런(WP-286) 입력 — 전 노트 본문을 JSON 배열 [{id, body}] 한 줄로 내보낸다. 읽기 전용(SELECT 만).
--
-- 실행(저장소 루트에서, 로컬 개발 DB):
--   docker exec -i smart-workplace-db-1 psql -U app -d workplace -XAt -f - \
--     < apps/workplace-collab/scripts/export-wiki-bodies.sql > /tmp/wiki-bodies.json
--   pnpm --filter @smart-workplace/workplace-collab dryrun /tmp/wiki-bodies.json
--
-- \copy ... to stdout 은 쓰지 않는다 — COPY 텍스트 형식이 백슬래시를 두 겹으로 만들고 개행을 \n 으로 이스케이프해
-- JSON 이 깨지거나 본문에 실제 개행 대신 문자 '\n' 이 들어간다. -A(정렬 없음)·-t(값만) 로 SELECT 결과를 그대로 받는다.
-- 테이블 소유자(app)로 접속하므로 테넌트 RLS 와 무관하게 전 테넌트 노트가 나온다. 결과 파일엔 실제 노트 내용이 담기므로
-- 저장소 밖(/tmp 등)에 두고 공유하지 않는다.
select coalesce(json_agg(json_build_object('id', id, 'body', body) order by id), '[]'::json)
from wiki_page;

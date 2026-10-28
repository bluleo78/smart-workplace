-- V227: 노트 공유 기록의 접근 요청 설명에서 요청한 사람 이름을 뺀다(WP-1066).
--
-- 공유 창은 기록을 「{행위자}님이 {detail}」로 그린다. ACCESS_REQUESTED 의 행위자는 요청한 사람인데 detail 이
-- 「<이름> 님이 접근을 요청했습니다」라 「park사원님이 park사원 님이 접근을 요청했습니다」처럼 이름이 두 번 보였다.
-- 새 기록은 서버가 「접근을 요청했습니다」만 남기므로, 이미 쌓인 기록도 같은 문구로 바꾼다.
-- 데이터만 고치는 UPDATE 라 롤링 배포 중 구 파드가 옛 문구로 남긴 줄은 이 마이그레이션 뒤에 남을 수 있다(보기만 어색, 동작 영향 없음).
-- 요청한 사람이 지워져 행위자가 비었으면(actor_id ON DELETE SET NULL — 화면은 「시스템」) detail 의 이름이 누가 요청했는지 알려 주는
-- 유일한 단서라 그대로 둔다.
-- wiki_page_share_event 는 RLS ENABLE(미-FORCE) — Flyway 소유자 롤로 테넌트 무관하게 돈다(V223 과 같은 전제).
UPDATE wiki_page_share_event
   SET detail = jsonb_build_object('text', '접근을 요청했습니다')
 WHERE type = 'ACCESS_REQUESTED'
   AND actor_id IS NOT NULL
   AND detail ->> 'text' LIKE '% 님이 접근을 요청했습니다';

-- V188 (WP-475): 프로젝트에서 이미 빠진 사람의 이슈 대화 멤버 row 를 한 번 정리한다.
-- 접근 판정은 이제 프로젝트 권한으로 하지만(ChatThreadAccess), 실시간 알림(SSE)·대화 멤버 목록은 chat_thread_member 를 그대로 쓴다.
-- 새 제거는 ChatProjectMemberRemovalCleanup 이 같은 트랜잭션에서 정리한다 — 이 마이그레이션은 그 이전에 남은 row 만 지운다.
-- 대상: 사람(HUMAN)이면서 그 이슈 프로젝트의 멤버가 아닌 row. OPEN 프로젝트는 비멤버도 조회·참여(이슈 reporter 등)할 수 있어 제외하고,
-- 멘션으로 들어온 AGENT 는 프로젝트 비멤버가 정상이라 제외한다. 비멤버 ADMIN 의 row 도 지워지지만 다시 글을 쓰면 자동 참여한다.
-- 데이터만 지우므로 구·신 버전 공존(롤링 배포)에 영향이 없다. 소유자 app 은 BYPASSRLS 라 전 테넌트에 적용된다.
DELETE FROM chat_thread_member m
USING chat_thread t, issue i, project p, "user" u
WHERE m.thread_id = t.id
  AND t.issue_id = i.id
  AND i.project_id = p.id
  AND u.id = m.user_id
  AND u.kind = 'HUMAN'
  AND p.type <> 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM project_member pm WHERE pm.project_id = p.id AND pm.user_id = m.user_id
  );

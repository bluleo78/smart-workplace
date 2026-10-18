-- V189 (WP-476): 프로젝트에서 이미 빠져 그 프로젝트를 볼 수 없는 사람의 이슈 워처 row 를 한 번 정리한다.
-- 워처 row 가 남으면 제거 뒤 생긴 알림·활동 피드·실시간 이벤트가 계속 가고 바뀐 이슈 제목까지 보인다.
-- 새 제거는 WatcherProjectMemberRemovalCleanup 이 같은 트랜잭션에서 정리한다 — 이 마이그레이션은 그 이전에 남은 row 만 지운다.
-- 남기는 것(ProjectAccessGuard 조회 규칙과 같음): OPEN 프로젝트, 프로젝트 멤버, 비PERSONAL 프로젝트의 같은 테넌트 ADMIN.
-- 데이터만 지우므로 구·신 버전 공존(롤링 배포)에 영향이 없다. 소유자 app 은 BYPASSRLS 라 전 테넌트에 적용된다.
DELETE FROM issue_watcher w
USING issue i, project p
WHERE w.issue_id = i.id
  AND i.project_id = p.id
  AND p.type <> 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM project_member pm WHERE pm.project_id = p.id AND pm.user_id = w.user_id
  )
  AND NOT (
    p.type <> 'PERSONAL'
    AND EXISTS (
      SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
      WHERE ur.user_id = w.user_id AND r.name = 'ADMIN' AND ur.tenant_id = w.tenant_id
    )
  );

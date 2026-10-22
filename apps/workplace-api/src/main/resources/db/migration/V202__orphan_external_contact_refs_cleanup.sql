-- V202 (WP-820): 지워진 외부 연락처를 가리키는 즐겨찾기·그룹 멤버 행을 한 번 정리한다.
-- contact_favorite·user_group_member 의 EXTERNAL 행은 target_id 로 contact_entry 를 가리키는 다형 참조라 외래 키가 없고, 연락처 삭제
-- (그리고 에이전트 삭제의 owner_id CASCADE)가 이 행들을 지우지 않아 DB 에 남았다. 화면은 contact_entry 와 조인해 감춰 왔다.
-- 새 삭제는 ContactRepository.delete·ContactService.onAgentDeleted 가 같은 트랜잭션에서 지운다 — 이 마이그레이션은 그 이전에 남은 행만 지운다.
-- 데이터만 지우므로 구·신 버전 공존(롤링 배포)에 영향이 없다. 소유자 app 은 BYPASSRLS 라 전 테넌트에 적용된다.
DELETE FROM contact_favorite f
WHERE f.target_type = 'EXTERNAL'
  AND NOT EXISTS (SELECT 1 FROM contact_entry c WHERE c.id = f.target_id);

DELETE FROM user_group_member m
WHERE m.target_type = 'EXTERNAL'
  AND NOT EXISTS (SELECT 1 FROM contact_entry c WHERE c.id = m.target_id);

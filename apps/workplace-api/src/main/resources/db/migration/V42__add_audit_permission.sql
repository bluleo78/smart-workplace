-- audit:read 권한 추가
-- V3__init_audit_security.sql 에서 audit_log 테이블만 생성했으나 권한 시드가 누락되어
-- ADMIN 포함 모든 역할이 감사 로그 API (audit:read) 에 접근 불가한 문제를 수정.
INSERT INTO permission (code, description, category)
VALUES ('audit:read', '감사 로그 조회', 'audit');

-- ADMIN 역할에 audit:read 권한 부여
-- (V2의 bulk 할당은 최초 1회만 실행되므로 신규 권한은 별도 삽입 필요)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name = 'ADMIN' AND p.code = 'audit:read';

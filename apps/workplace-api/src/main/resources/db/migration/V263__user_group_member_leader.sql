-- WP-1327 조직 리더 — 조직도 부서(SHARED 그룹)의 구성원 중 리더를 구분한다. 한 부서에 여러 명이 리더일 수 있어 그룹이 아니라 소속 행에 둔다.
-- 리더 지정은 구성원(MEMBER) 행에만 의미가 있다(외부 연락처·개인 그룹은 서비스가 거절한다). 기본값 false 라 기존 행·구 버전 코드에 영향이 없다(expand).
ALTER TABLE user_group_member
    ADD COLUMN is_leader BOOLEAN NOT NULL DEFAULT FALSE;

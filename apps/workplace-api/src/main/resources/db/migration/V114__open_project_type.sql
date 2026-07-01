-- 공개 접수함(OPEN) 프로젝트 유형 도입 — project.type CHECK 제약을 TEAM/PERSONAL/OPEN 으로 확장.
-- OPEN 은 구조상 TEAM 과 동일하고 런타임 권한 게이트만 다르므로 컬럼/스키마 변경은 CHECK 뿐이다.
ALTER TABLE project DROP CONSTRAINT project_type_check;
ALTER TABLE project
  ADD CONSTRAINT project_type_check CHECK (type IN ('TEAM', 'PERSONAL', 'OPEN'));

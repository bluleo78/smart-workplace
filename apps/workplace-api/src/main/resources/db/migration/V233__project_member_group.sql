-- V233 (WP-1057): 팀 프로젝트(TEAM·OPEN) 멤버에 조직도 부서(부서 자체)를 둔다.
--
-- project_member_group — 프로젝트의 멤버로 둔 조직도 부서(user_group, visibility=SHARED). 그 부서나 하위 부서의 활성 사람 구성원이
-- MEMBER 로 프로젝트에 들어온다. 소속은 판정할 때마다 다시 본다(나중에 들어온 사람은 열리고, 빠진 사람은 막힌다) — 그래서 사람을 펼쳐 저장하지
-- 않고 부서 행만 둔다(V228 wiki_space_member_group 과 같은 방식). 사람의 실효 역할은 직접 멤버 행(project_member)과 부서 행 중 높은 것이다.
-- 개인 그룹(PERSONAL)·개인 프로젝트(PERSONAL)는 두지 않는다 — 서버가 막는다(DB 는 visibility·프로젝트 유형을 모른다).
--
-- - 역할은 MEMBER 만 — 멤버 관리·프로젝트 설정 권한(OWNER)을 부서 전체에 주지 않는다. 마지막 소유자 보호는 직접 멤버 행만 본다.
-- - 프로젝트 행은 soft-delete 라 지워지지 않지만 FK 는 CASCADE 로 둔다(테넌트 정리 등 실제 삭제 때 함께). 부서가 지워지면 멤버에서도 빠진다
--   (CASCADE — 하위 부서 삭제도 parent_id CASCADE 로 함께).
-- - 추가한 사람(added_by)이 지워지면 NULL(V228 과 같은 관례).
-- - V195·V228 의 테넌트 패턴(tenant_id 기본값 GUC, RLS USING + WITH CHECK, app_tenant 권한 명시).
-- 롤링 배포 호환(expand): 새 테이블만 더한다 — 기존 코드는 이 테이블을 모르고, 행이 없을 때의 판정은 지금과 같다.
CREATE TABLE project_member_group (
  project_id BIGINT      NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  group_id   BIGINT      NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
  role       VARCHAR(20) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER')),
  tenant_id  BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                         REFERENCES tenant(id),
  added_by   BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,  -- NULL = 지운 사용자
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, group_id)
);
CREATE INDEX idx_project_member_group_tenant ON project_member_group(tenant_id);
-- 부서 삭제의 ON DELETE CASCADE 와 「내 부서가 걸린 프로젝트」 판정·부서 구성원 감소 처리가 group_id 로 찾는다.
CREATE INDEX idx_project_member_group_group ON project_member_group(group_id);
CREATE INDEX idx_project_member_group_added_by ON project_member_group(added_by);

ALTER TABLE project_member_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_member_group_tenant_isolation ON project_member_group
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_member_group TO app_tenant;

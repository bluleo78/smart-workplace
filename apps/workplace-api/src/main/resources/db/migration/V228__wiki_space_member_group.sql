-- V227 (WP-1052): 노트 스페이스 멤버에 조직도 부서(부서 자체)를 둔다.
--
-- wiki_space_member_group — 스페이스의 멤버로 둔 조직도 부서(user_group, visibility=SHARED)와 그 역할. 그 부서나 하위 부서의 활성
-- 사람 구성원이 이 역할로 스페이스에 들어온다. 소속은 판정할 때마다 다시 본다(나중에 들어온 사람은 열리고, 빠진 사람은 막힌다) — 그래서 사람을
-- 펼쳐 저장하지 않고 부서 행만 둔다(V225 wiki_page_share_group 과 같은 방식). 사람의 실효 역할은 직접 멤버 행(wiki_space_member)과
-- 자기가 걸리는 부서 행 중 가장 높은 것이다.
-- 개인 그룹(PERSONAL)은 두지 않는다 — 서버가 SHARED 만 받는다(DB 는 visibility 를 모른다).
--
-- - 역할은 EDITOR·VIEWER 만 — 멤버 관리 권한(OWNER)을 부서 전체에 주지 않는다. 마지막 소유자 보호는 직접 멤버 행만 본다.
-- - 스페이스가 지워지면 함께 지운다(CASCADE). 부서가 지워지면 멤버에서도 빠진다(CASCADE — 하위 부서 삭제도 parent_id CASCADE 로 함께).
-- - 추가한 사람(added_by)이 지워지면 NULL(V225 와 같은 관례).
-- - V195·V225 의 테넌트 패턴(tenant_id 기본값 GUC, RLS USING + WITH CHECK, app_tenant 권한 명시).
-- 롤링 배포 호환(expand): 새 테이블만 더한다 — 기존 코드는 이 테이블을 모르고, 행이 없을 때의 판정은 지금과 같다.
CREATE TABLE wiki_space_member_group (
  space_id  BIGINT      NOT NULL REFERENCES wiki_space(id) ON DELETE CASCADE,
  group_id  BIGINT      NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
  role      VARCHAR(16) NOT NULL CHECK (role IN ('EDITOR', 'VIEWER')),
  tenant_id BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                        REFERENCES tenant(id),
  added_by  BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,  -- NULL = 지운 사용자
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (space_id, group_id)
);
CREATE INDEX idx_wiki_space_member_group_tenant ON wiki_space_member_group(tenant_id);
-- 부서 삭제의 ON DELETE CASCADE 와 「내 부서가 걸린 스페이스」 판정·부서 구성원 감소 처리가 group_id 로 찾는다.
CREATE INDEX idx_wiki_space_member_group_group ON wiki_space_member_group(group_id);
CREATE INDEX idx_wiki_space_member_group_added_by ON wiki_space_member_group(added_by);

ALTER TABLE wiki_space_member_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_space_member_group_tenant_isolation ON wiki_space_member_group
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_space_member_group TO app_tenant;

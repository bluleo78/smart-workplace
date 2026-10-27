-- V225 (WP-1023): 노트 공유를 조직도 부서(팀) 단위로 — 지정한 사람(PEOPLE) 공유의 대상에 부서를 더한다.
--
-- wiki_page_share_group — audience=PEOPLE 공유가 여는 조직도 부서(user_group, visibility=SHARED). 그 부서나 하위 부서의 MEMBER 인
-- 사용자는 링크를 열 수 있다. 소속은 열 때마다 다시 본다(나중에 들어온 사람은 열리고, 빠진 사람은 막힌다) — 그래서 사람을 펼쳐 저장하지 않고 부서 행만 둔다.
-- 개인 그룹(PERSONAL)은 대상으로 두지 않는다(공유 창이 저장 시점의 사람으로 펼쳐 넣는다) — 서버가 SHARED 만 받는다(DB 는 visibility 를 모른다).
--
-- - 공유가 지워지면 함께 지운다(CASCADE). 부서가 지워지면 대상에서도 빠진다(CASCADE — 하위 부서 삭제도 parent_id CASCADE 로 함께).
-- - 지정한 사람(added_by)이 지워지면 NULL(V195 의 wiki_page_share_member 와 같은 관례).
-- - V195 의 테넌트 패턴(tenant_id 기본값 GUC, RLS USING + WITH CHECK, app_tenant 권한 명시).
-- 롤링 배포 호환(expand): 새 테이블만 더한다 — 기존 코드는 이 테이블을 모르고, 행이 없을 때의 판정은 지금과 같다.
CREATE TABLE wiki_page_share_group (
  share_id  BIGINT      NOT NULL REFERENCES wiki_page_share(id) ON DELETE CASCADE,
  group_id  BIGINT      NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
  tenant_id BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                        REFERENCES tenant(id),
  added_by  BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,  -- NULL = 지운 사용자
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (share_id, group_id)
);
CREATE INDEX idx_wiki_page_share_group_tenant ON wiki_page_share_group(tenant_id);
-- 부서 삭제의 ON DELETE CASCADE 와 「내 부서가 걸린 공유」 판정이 group_id 로 찾는다.
CREATE INDEX idx_wiki_page_share_group_group ON wiki_page_share_group(group_id);
CREATE INDEX idx_wiki_page_share_group_added_by ON wiki_page_share_group(added_by);

ALTER TABLE wiki_page_share_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_share_group_tenant_isolation ON wiki_page_share_group
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_page_share_group TO app_tenant;

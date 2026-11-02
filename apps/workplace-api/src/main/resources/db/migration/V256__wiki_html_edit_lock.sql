-- V256 (WP-1308): 「HTML 문서」 페이지 편집 잠금과 고치던 내용의 임시 저장본.
--
-- HTML 문서는 노트처럼 동시 편집하지 않는다 — 「편집」을 누른 한 사람만 고치고(잠금), 다른 사람은 저장될 때까지 보기만 한다.
-- 새 테이블만 더한다(롤링 배포 호환 — 구 코드는 이 테이블을 모르고, 잠금 없이 저장해도 낙관적 version 이 지킨다).
-- 테넌트 패턴은 V249·V251 과 같다(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
-- app_tenant 권한은 V44 의 ALTER DEFAULT PRIVILEGES 로 자동 부여된다.

-- wiki_html_edit_lock — 페이지당 한 줄(PK page_id). 입력이 10분 없으면(last_active_at 기준) 풀린 것으로 본다 — 지우는 작업 없이
--   읽을 때 판정하고, 다음 잠금이 같은 줄을 덮어쓴다(INSERT … ON CONFLICT … WHERE 만료). 페이지·사람이 지워지면 함께(CASCADE).
--   token — 편집 세션(「편집」을 누른 창 하나) 표지. 잠금을 얻을 때마다 새로 만들고, 편집 중 신호·취소·저장이 이것을 돌려줘야 그 세션의 잠금으로 본다.
--   사람(user_id)이 아니라 세션으로 가르는 까닭: 같은 사람의 다른 창·그 사람 이름으로 도는 AI 저장이 편집 중인 창의 잠금을 풀거나 임시 저장본을 지우지 않게.
CREATE TABLE wiki_html_edit_lock (
  page_id        BIGINT       PRIMARY KEY REFERENCES wiki_page(id) ON DELETE CASCADE,
  tenant_id      BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  user_id        BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token          UUID         NOT NULL,
  acquired_at    TIMESTAMPTZ  NOT NULL,
  last_active_at TIMESTAMPTZ  NOT NULL,
  CONSTRAINT fk_wiki_html_edit_lock_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 사람 삭제의 ON DELETE CASCADE 가 user_id 로 찾는다.
CREATE INDEX idx_wiki_html_edit_lock_user ON wiki_html_edit_lock(user_id);

ALTER TABLE wiki_html_edit_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_html_edit_lock FORCE ROW LEVEL SECURITY;
CREATE POLICY wiki_html_edit_lock_tenant_isolation ON wiki_html_edit_lock
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- wiki_html_draft — 페이지×사람 한 줄. 편집 중 주기적으로 보낸 소스(최대 5MB — API 가 지킨다)와 고치기 시작한 판(base_version).
--   잠금이 풀려도(10분·강제 풀기) 남고, 저장·취소하면 지운다. 다음 「편집」 때 이어 고칠지 묻고, base_version 이 지금 판과 다르면
--   그사이 다른 사람이 저장했다고 알린다. 페이지·사람이 지워지면 함께(CASCADE).
CREATE TABLE wiki_html_draft (
  page_id      BIGINT       NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  user_id      BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id    BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  html_source  TEXT         NOT NULL,
  base_version INT          NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY (page_id, user_id),
  CONSTRAINT fk_wiki_html_draft_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 사람 삭제의 ON DELETE CASCADE 가 user_id 로 찾는다.
CREATE INDEX idx_wiki_html_draft_user ON wiki_html_draft(user_id);

ALTER TABLE wiki_html_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_html_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY wiki_html_draft_tenant_isolation ON wiki_html_draft
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

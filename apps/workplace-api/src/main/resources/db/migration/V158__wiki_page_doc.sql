-- 노트 실시간 동시 편집(WP-171/WP-286) — Yjs 문서 상태 원본. wiki_page.body 는 이 상태에서 파생되는 마크다운 사본.
-- body_version: 이 상태로부터 파생 저장된 body 의 wiki_page.version. 로드 시 wiki_page.version 이 더 크면
-- collab 밖에서 body 가 바뀐 것(롤백·구버전 경로)이라 동기화 서버가 body 기준으로 맞춘다.
-- expand 단계 — 새 테이블만 추가하므로 구버전 앱과 공존한다.
CREATE TABLE wiki_page_doc (
  page_id      BIGINT PRIMARY KEY REFERENCES wiki_page(id) ON DELETE CASCADE,
  tenant_id    BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint REFERENCES tenant(id),
  state        BYTEA NOT NULL,
  body_version INT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wiki_page_doc_tenant ON wiki_page_doc(tenant_id);

-- 테넌트 격리 RLS (NULLIF fail-closed — GUC 미설정이면 0행).
ALTER TABLE wiki_page_doc ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_doc_tenant_isolation ON wiki_page_doc
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

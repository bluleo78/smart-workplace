-- 노트 AI 병합 기준본(WP-289, 스펙 §3.1·§3.3) — AI·구버전 웹이 "읽은 판"의 본문. version 으로 본문 PUT 이 오면 이 본문을
-- 기준으로 현재 실시간 문서와 3-way 병합한다. 페이지 상세 조회·생성·본문 저장 응답 때 기록하고 read_at 기준 1시간 보관
-- (정리 스케줄러 — 단 그 페이지의 현재 version 행은 남긴다). expand 단계 — 새 테이블만 추가하므로 구버전 앱과 공존한다.
-- body = 그 version 의 실제 본문. submitted_body = 그 version 이 본문 저장 응답이었으면 그때 제출된 본문 — 구버전 웹은 응답 본문을
-- 화면에 넣지 않고 자기 본문에서 이어 쓰므로, 동기화 서버가 둘 중 다음 저장 본문에 가까운 쪽을 기준으로 고른다.
CREATE TABLE wiki_page_body_history (
  page_id        BIGINT      NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  tenant_id      BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint REFERENCES tenant(id),
  version        INT         NOT NULL,
  body           TEXT        NOT NULL,
  submitted_body TEXT,
  read_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, version)
);
CREATE INDEX idx_wiki_page_body_history_tenant ON wiki_page_body_history(tenant_id);
CREATE INDEX idx_wiki_page_body_history_read_at ON wiki_page_body_history(read_at);

-- 테넌트 격리 RLS (NULLIF fail-closed — GUC 미설정이면 0행).
ALTER TABLE wiki_page_body_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_body_history_tenant_isolation ON wiki_page_body_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

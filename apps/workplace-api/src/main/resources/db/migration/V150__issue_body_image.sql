-- V150__issue_body_image.sql
-- 이슈 본문(마크다운)에 삽입된 이미지 매핑(WP-199).
-- 업로드 시점엔 이슈가 없을 수 있어(생성 다이얼로그) issue_id 는 NULL 허용 = "아직 연결 전 임시 업로드".
-- project_id·uploaded_by 를 업로드 시점에 남겨야, 저장 시 연결(claim)과 조회에서 "이 프로젝트에 이 사람이 올린 이슈 이미지인가" 를
-- 검증할 수 있다(다른 도메인 임시 파일·다른 프로젝트 파일을 URL 조작으로 끌어오는 것 차단).
-- 수명은 file.expires_at 이 관리한다(임시 24h / 연결 시 NULL / 본문에서 빠지면 유예 후 재무장). 수거되면 CASCADE 로 매핑도 사라진다.
-- issue_attachment(V8)는 멀티테넌시 이전 유물이라 tenant_id 가 없다 — wiki_page_attachment(V126) 패턴을 따른다.
CREATE TABLE issue_body_image (
  file_id     BIGINT      PRIMARY KEY REFERENCES file(id) ON DELETE CASCADE,
  tenant_id   BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  project_id  BIGINT      NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  issue_id    BIGINT      REFERENCES issue(id) ON DELETE CASCADE,
  uploaded_by BIGINT      NOT NULL REFERENCES "user"(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  demoted_at  TIMESTAMPTZ
);

CREATE INDEX idx_issue_body_image_tenant ON issue_body_image(tenant_id);
CREATE INDEX idx_issue_body_image_issue ON issue_body_image(issue_id);
-- 업로드 남용 상한(사용자·프로젝트별 미연결 개수) 카운트용 부분 인덱스.
CREATE INDEX idx_issue_body_image_pending ON issue_body_image(project_id, uploaded_by) WHERE issue_id IS NULL;

ALTER TABLE issue_body_image ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_body_image_tenant_isolation ON issue_body_image
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

COMMENT ON TABLE issue_body_image IS '이슈 본문 이미지 매핑. issue_id NULL = 저장 전 임시 업로드(WP-199).';

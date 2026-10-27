-- V220 (WP-1001): 프로젝트 즐겨찾기를 서버에 저장한다.
--
-- 지금까지 즐겨찾기는 브라우저 localStorage 에만 있어(WP-701 키) 브라우저가 저장소를 지우거나, 다른 창의 옛 값으로 덮어쓰거나,
-- 기기를 바꾸면 비거나 달라졌다. 연락처 즐겨찾기(contact_favorite)처럼 사용자·프로젝트별 행으로 둔다.
-- 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- - PK 선두에 tenant_id: user 는 전역 신원이라 (user_id, project_id) 만으로는 테넌트 경계를 PK 가 넘는다(V60 과 같은 이유).
-- - 프로젝트·사용자가 지워지면 함께 지운다. 프로젝트 soft-delete 는 조회에서 거른다.
-- - V89 의 테넌트 패턴(tenant_id 기본값 GUC, FK·인덱스, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
CREATE TABLE project_favorite (
  tenant_id   BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  user_id     BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  project_id  BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, project_id),
  CONSTRAINT fk_project_favorite_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 프로젝트 삭제 CASCADE 가 project_id 로 찾는다(PK 는 tenant_id·user_id 가 앞이라 이 방향을 못 받친다).
CREATE INDEX idx_project_favorite_project ON project_favorite(project_id);

ALTER TABLE project_favorite ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_favorite FORCE ROW LEVEL SECURITY;
CREATE POLICY project_favorite_tenant_isolation ON project_favorite
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

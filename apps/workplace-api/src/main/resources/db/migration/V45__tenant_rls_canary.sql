-- V45: RLS 격리 증명용 카나리아 테이블.
-- app_tenant(비소유·비bypass) 로 접근 시 app.tenant_id GUC 로 행이 격리됨을 증명한다.
-- 운영 도메인 아님 — P2 의 RLS 패턴 레퍼런스 + 회귀 가드.
-- app_tenant 의 테이블/시퀀스 권한은 V44 의 ALTER DEFAULT PRIVILEGES 로 자동 부여된다
-- (이 자동 부여가 동작함을 카나리아 격리 테스트가 함께 증명한다).
CREATE TABLE tenant_canary (
    id         BIGSERIAL   PRIMARY KEY,
    tenant_id  BIGINT      NOT NULL,
    val        VARCHAR(64) NOT NULL
);
CREATE INDEX idx_tenant_canary_tenant ON tenant_canary(tenant_id);

ALTER TABLE tenant_canary ENABLE ROW LEVEL SECURITY;

-- current_setting(...,true): GUC 미설정 시 NULL → 비교가 NULL → 행 비가시(fail-closed).
-- WITH CHECK: 현재 GUC 와 다른 tenant_id 삽입 차단.
CREATE POLICY tenant_canary_isolation ON tenant_canary
  USING (tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::bigint);

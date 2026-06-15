-- V74: user_dashboard — 사용자별 홈 대시보드 레이아웃(위젯 타입 키의 정렬된 배열) 영속.
-- 사용자가 위젯을 추가/제거/순서변경한 결과를 계정당 1행으로 저장(기기 간 동기화).
-- 신규 테이블이라 tenant_id 는 생성 시 바로 NOT NULL + DEFAULT(GUC). 백필 불필요.
-- RLS 는 V67/V68/V72 와 동일한 NULLIF fail-closed 패턴(소유자 롤 app 은 BYPASSRLS).

CREATE TABLE user_dashboard (
  id         BIGSERIAL    PRIMARY KEY,
  tenant_id  BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                          REFERENCES tenant(id),
  user_id    BIGINT       NOT NULL REFERENCES "user"(id),
  widgets    JSONB        NOT NULL,   -- 위젯 타입 키의 정렬된 배열. 예: ["my_tasks","calendar_today",...]
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT user_dashboard_uq UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_user_dashboard_tenant ON user_dashboard(tenant_id);

ALTER TABLE user_dashboard ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_dashboard_tenant_isolation ON user_dashboard
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

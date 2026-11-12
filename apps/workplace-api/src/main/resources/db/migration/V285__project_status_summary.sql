-- V285 (WP-1479): 프로젝트 개요 「프로젝트 상태」 AI 요약 — 간격 설정 컬럼 + 요약 저장 테이블. 새 컬럼(기본값)·새 테이블만 더한다(롤링 배포 호환).
--
-- status_summary_interval: 요약을 다시 만드는 간격(H1|H2|H4|DAILY). 기본 2시간 — 값 검증은 앱(PATCH)이 하고 DB 는 CHECK 로 한 번 더 막는다.
alter table project add column status_summary_interval text not null default 'H2'
  check (status_summary_interval in ('H1','H2','H4','DAILY'));

-- project_status_summary: 프로젝트당 최신 요약 1건.
--   - input_hash: AI 에 넘긴 계산 입력의 해시 — 같으면 AI 를 부르지 않고 checked_at 만 갱신한다.
--   - next_run_at: 다음 점검 시각. claim 이 이 값을 앞으로 밀어 같은 주기에 두 번 도는 것을 막는다(NULL = 즉시 대상).
-- V282 와 같은 테넌트 컬럼·RLS 정책 모양.
CREATE TABLE project_status_summary (
  project_id    BIGINT       PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  badge         VARCHAR(16),
  summary       TEXT,
  input_hash    VARCHAR(64),
  generated_at  TIMESTAMPTZ,
  checked_at    TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  CONSTRAINT fk_project_status_summary_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_project_status_summary_tenant ON project_status_summary(tenant_id);
CREATE INDEX idx_project_status_summary_next_run ON project_status_summary(next_run_at);

ALTER TABLE project_status_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_status_summary FORCE ROW LEVEL SECURITY;
CREATE POLICY project_status_summary_tenant_isolation ON project_status_summary
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

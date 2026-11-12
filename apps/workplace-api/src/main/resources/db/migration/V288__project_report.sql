-- V288 (WP-1483): 프로젝트 주간 리포트 — 설정 테이블 + 회차 테이블. 새 테이블만 더한다(롤링 배포 호환).
-- V285 와 같은 테넌트 컬럼·RLS 정책 모양. jOOQ 코드젠 없이 이름(DSL.name)으로 다룬다.

-- project_report_setting: 프로젝트당 리포트 설정 1행. 행이 없으면 기본값(꺼짐·매주·월요일·09:00)으로 본다.
--   - time_of_day: KST 정시만(앱이 검증).
--   - template_page_id: 「리포트」 아래 템플릿 노트 — 사람이 지우면 NULL 이 되고 다음에 켤 때·생성 때 다시 복사한다.
--   - next_run_at: 다음 생성 시각. NULL = 꺼짐 또는 아직 안 정함. 실행기가 조건부 갱신으로 점유한다.
--   - consecutive_failures / last_attempt_at / last_error: 실패 재시도(30분)·연속 3회면 다음 예정으로 넘김. last_error 는 앞 500자.
CREATE TABLE project_report_setting (
  project_id           BIGINT       PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  tenant_id            BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  enabled              BOOLEAN      NOT NULL DEFAULT false,
  cadence              TEXT         NOT NULL DEFAULT 'WEEKLY'
    CHECK (cadence IN ('WEEKLY','BIWEEKLY','MONTHLY')),
  weekday              TEXT         NOT NULL DEFAULT 'MONDAY'
    CHECK (weekday IN ('MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY')),
  time_of_day          TIME         NOT NULL DEFAULT '09:00',
  template_page_id     BIGINT       REFERENCES wiki_page(id) ON DELETE SET NULL,
  next_run_at          TIMESTAMPTZ,
  consecutive_failures INT          NOT NULL DEFAULT 0,
  last_attempt_at      TIMESTAMPTZ,
  last_error           TEXT,
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_report_setting_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_project_report_setting_tenant ON project_report_setting(tenant_id);
CREATE INDEX idx_project_report_setting_next_run ON project_report_setting(next_run_at);
CREATE INDEX idx_project_report_setting_template ON project_report_setting(template_page_id);

ALTER TABLE project_report_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_report_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY project_report_setting_tenant_isolation ON project_report_setting
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- project_report: 회차 기록. (project_id, period_start, period_end) 유일 — 같은 회차를 두 번 만들지 않는다.
--   주기를 바꾸면 길이가 다른 회차가 같은 날 시작할 수 있어(매주 11/9~15 → 격주 11/9~22) 끝날까지 넣어 구분한다.
--   - period_start / period_end: KST 날짜, 끝 포함.
--   - status: PENDING(점유됨) · GENERATED(페이지 만듦) · SKIPPED(변화 없음 — 페이지 없이 기록만)
--     · FAILED(페이지를 만든 뒤 연속 실패 상한 — 페이지는 남기되 리포트로 치지 않는다).
--   - badge: 생성 때 시스템 배지(ON_TRACK|WARN|RISK). completed·created·open_issues·overdue: 다음 회차 「변화」 기준 스냅숏.
CREATE TABLE project_report (
  id            BIGSERIAL    PRIMARY KEY,
  project_id    BIGINT       NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  period_start  DATE         NOT NULL,
  period_end    DATE         NOT NULL,
  status        TEXT         NOT NULL CHECK (status IN ('PENDING','GENERATED','SKIPPED','FAILED')),
  page_id       BIGINT       REFERENCES wiki_page(id) ON DELETE SET NULL,
  badge         TEXT,
  completed     INT,
  created       INT,
  open_issues   INT,
  overdue       INT,
  reserved_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_report_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
  CONSTRAINT uq_project_report_period UNIQUE (project_id, period_start, period_end)
);
CREATE INDEX idx_project_report_tenant ON project_report(tenant_id);
CREATE INDEX idx_project_report_project_period ON project_report(project_id, period_start DESC);
CREATE INDEX idx_project_report_page ON project_report(page_id);

ALTER TABLE project_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_report FORCE ROW LEVEL SECURITY;
CREATE POLICY project_report_tenant_isolation ON project_report
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

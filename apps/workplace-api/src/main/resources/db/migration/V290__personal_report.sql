-- V290 (WP-1486): 개인 일일·주간·월간 보고 — 설정 테이블 + 회차 테이블. 새 테이블만 더한다(롤링 배포 호환).
-- V288 과 같은 테넌트 컬럼·RLS 정책 모양.

-- personal_report_setting: 워크스페이스(테넌트)마다 사람당 설정 1행. 행이 없으면 기본값(꺼짐·09:00·건너뜀 켬)으로 본다.
--   - PK (tenant_id, user_id): 멤버십·개인 공간이 테넌트별이라(한 사람이 여러 워크스페이스에 속함) 설정도 테넌트별로 둔다.
--   - time_of_day: KST 정시만(앱이 검증).
--   - daily_template_page_id / weekly_template_page_id: 「내 노트 › 보고」 아래 템플릿 노트(월간은 주간 칸 공유). 사람이 지우면 NULL.
--   - next_run_at: 다음 자동 일일 생성 시각. NULL = 꺼짐. 실행기가 조건부 갱신으로 점유한다.
--   - consecutive_failures / last_attempt_at / last_error: 실패 재시도(30분)·연속 3회면 그날을 넘김. last_error 는 앞 500자.
CREATE TABLE personal_report_setting (
  user_id                  BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id                BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  daily_enabled            BOOLEAN      NOT NULL DEFAULT false,
  time_of_day              TIME         NOT NULL DEFAULT '09:00',
  skip_empty               BOOLEAN      NOT NULL DEFAULT true,
  daily_template_page_id   BIGINT       REFERENCES wiki_page(id) ON DELETE SET NULL,
  weekly_template_page_id  BIGINT       REFERENCES wiki_page(id) ON DELETE SET NULL,
  next_run_at              TIMESTAMPTZ,
  consecutive_failures     INT          NOT NULL DEFAULT 0,
  last_attempt_at          TIMESTAMPTZ,
  last_error               TEXT,
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT fk_personal_report_setting_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 테넌트 조회는 PK(tenant_id, user_id) 앞머리가 맡는다. 사용자 삭제 CASCADE 용 user_id 인덱스.
CREATE INDEX idx_personal_report_setting_user ON personal_report_setting(user_id);
-- 실행기는 켜진 설정(daily_enabled)만 next_run_at 순으로 고르므로 꺼진 행은 인덱스에 넣지 않는다.
CREATE INDEX idx_personal_report_setting_next_run ON personal_report_setting(next_run_at) WHERE daily_enabled;
CREATE INDEX idx_personal_report_setting_daily_template ON personal_report_setting(daily_template_page_id);
CREATE INDEX idx_personal_report_setting_weekly_template ON personal_report_setting(weekly_template_page_id);

ALTER TABLE personal_report_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_report_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY personal_report_setting_tenant_isolation ON personal_report_setting
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- personal_report: 회차 기록. 같은 회차라도 「새로 만들기」로 여러 편이 될 수 있어 행 unique 는 걸지 않는다.
--   - status: PENDING(점유됨) · GENERATED(페이지 만듦) · SKIPPED(한 일 없음 — 페이지 없이 기록만)
--     · FAILED(자동 연속 실패 상한 또는 수동 실패 기록).
--   - completed·created·status_changed: 생성 때 숫자(로그·디버그용). error: 실패 문구(앞 500자).
CREATE TABLE personal_report (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id       BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  kind            TEXT         NOT NULL CHECK (kind IN ('DAILY','WEEKLY','MONTHLY')),
  period_start    DATE         NOT NULL,
  period_end      DATE         NOT NULL,
  trigger         TEXT         NOT NULL CHECK (trigger IN ('AUTO','MANUAL')),
  status          TEXT         NOT NULL CHECK (status IN ('PENDING','GENERATED','SKIPPED','FAILED')),
  page_id         BIGINT       REFERENCES wiki_page(id) ON DELETE SET NULL,
  completed       INT,
  created         INT,
  status_changed  INT,
  error           TEXT,
  reserved_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_personal_report_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 동시에 같은 회차를 두 번 만들지 않게: 진행 중은 회차당 하나. 회차는 워크스페이스마다 따로라 tenant_id 를 앞에 둔다.
CREATE UNIQUE INDEX uq_personal_report_pending
  ON personal_report(tenant_id, user_id, kind, period_start, period_end) WHERE status = 'PENDING';
-- 자동 일일은 날마다 한 번(GENERATED·SKIPPED·FAILED 기록이 있으면 다시 안 만듦)
CREATE UNIQUE INDEX uq_personal_report_auto
  ON personal_report(tenant_id, user_id, kind, period_start) WHERE trigger = 'AUTO' AND status <> 'PENDING';
CREATE INDEX idx_personal_report_lookup ON personal_report(tenant_id, user_id, kind, period_start DESC);
-- 사용자 삭제 CASCADE 용(조회 인덱스는 tenant_id 가 앞이라 user_id 단독 조건에 못 쓴다). 테넌트 조회는 조회 인덱스 앞머리가 맡는다.
CREATE INDEX idx_personal_report_user ON personal_report(user_id);
CREATE INDEX idx_personal_report_page ON personal_report(page_id);

ALTER TABLE personal_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_report FORCE ROW LEVEL SECURITY;
CREATE POLICY personal_report_tenant_isolation ON personal_report
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

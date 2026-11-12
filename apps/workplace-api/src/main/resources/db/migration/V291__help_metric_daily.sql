-- WP-1512 도움말 지표: 도움말을 어디서 열고(OPEN), 검색이 비었고(SEARCH_MISS), AI 가 근거를 못 찾았는지(AI_GAP)를
-- 날짜별로 센 집계 표. 도움말 보강 우선순위를 정하는 데만 쓴다.
-- 개인정보를 두지 않는다 — 사용자·IP 컬럼이 없고 (일, 종류, 경로, 도움말 id, 검색어) 단위의 건수만 쌓는다.
-- route/help_id/term 은 NULL 대신 '' 를 쓴다 — NULL 은 UNIQUE 에서 서로 다른 값으로 취급돼 같은 키가 여러 행으로 갈라지기 때문.
-- day 는 서버 JVM 이 아니라 DB 가 KST(Asia/Seoul) 기준으로 계산한다(저장소가 채움).
-- 보존 180일은 스케줄러가 지운다(표 자체는 제한 없음). 새 테이블만 추가하는 expand-only 라 롤링 배포에 안전하다.
CREATE TABLE help_metric_daily (
  id        BIGSERIAL    PRIMARY KEY,
  tenant_id BIGINT       NOT NULL
              DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
              REFERENCES tenant(id),
  day       DATE         NOT NULL,
  kind      VARCHAR(16)  NOT NULL,
  route     VARCHAR(200) NOT NULL DEFAULT '',
  help_id   VARCHAR(100) NOT NULL DEFAULT '',
  term      VARCHAR(200) NOT NULL DEFAULT '',
  count     BIGINT       NOT NULL DEFAULT 1,
  last_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_help_metric_daily_kind CHECK (kind IN ('OPEN', 'SEARCH_MISS', 'AI_GAP')),
  -- upsert(ON CONFLICT) 대상 키 — 같은 날 같은 항목은 한 행의 count 만 올린다.
  CONSTRAINT uq_help_metric_daily UNIQUE (tenant_id, day, kind, route, help_id, term)
);
-- 상위 N 조회(테넌트·종류·기간 범위)용.
CREATE INDEX help_metric_daily_kind_day_idx ON help_metric_daily (tenant_id, kind, day);
-- 보존 기간 삭제(day < 기준)는 별도 인덱스 없이 uq_help_metric_daily (tenant_id, day, …) 가 맡는다(RLS 로 tenant_id 가 항상 걸린다).

-- RLS: ai_memory(V169) 와 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE help_metric_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_metric_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY help_metric_daily_tenant_isolation ON help_metric_daily
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON help_metric_daily TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE help_metric_daily_id_seq TO app_tenant;

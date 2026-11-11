-- V282 (WP-1485): 업무 프로파일 — 사람×기간(WEEK·MONTH·QUARTER) 최신 1건. 새 테이블만 더한다(롤링 배포 호환: 옛 코드는 이 테이블을 모른다).
--
-- 같은 테넌트·사람·기간은 한 행을 덮어쓴다(UNIQUE). 분석이 실패해도 이전 내용은 남기고 status/error 만 바꾼다.
--   - pending_since: PENDING 점유 시각. 분석 중 프로세스가 죽어 PENDING 이 남아도 10분이 지나면 다른 요청이 다시 점유할 수 있게 한다.
--   - manual_date / manual_count: 「다시 분석」 버튼의 하루(서울 날짜) 호출 횟수 상한 계수. 날짜가 바뀌면 1부터 다시 센다.
-- V275 와 같은 RLS 정책 모양.

CREATE TABLE work_profile (
  id             BIGSERIAL    PRIMARY KEY,
  tenant_id      BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  user_id        BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  period_type    VARCHAR(8)   NOT NULL CHECK (period_type IN ('WEEK','MONTH','QUARTER')),
  status         VARCHAR(8)   NOT NULL CHECK (status IN ('READY','PENDING','FAILED')),
  period_from    DATE,
  period_to      DATE,
  analyzed_at    TIMESTAMPTZ,
  fingerprint    VARCHAR(64),
  total_count    INT          NOT NULL DEFAULT 0,
  analyzed_count INT          NOT NULL DEFAULT 0,
  summary        TEXT,
  tasks          JSONB        NOT NULL DEFAULT '[]', -- [{name,count}]
  areas          JSONB        NOT NULL DEFAULT '[]', -- [{name,count}]
  skills         JSONB        NOT NULL DEFAULT '[]', -- [str]
  error          VARCHAR(200),
  pending_since  TIMESTAMPTZ,
  manual_date    DATE,
  manual_count   INT          NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- 한 사람이 여러 테넌트에 속할 수 있어 테넌트까지 키에 넣는다(테넌트마다 따로 한 행).
  CONSTRAINT uq_work_profile_tenant_user_period UNIQUE (tenant_id, user_id, period_type),
  CONSTRAINT fk_work_profile_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_work_profile_tenant ON work_profile(tenant_id);

ALTER TABLE work_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY work_profile_tenant_isolation ON work_profile
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

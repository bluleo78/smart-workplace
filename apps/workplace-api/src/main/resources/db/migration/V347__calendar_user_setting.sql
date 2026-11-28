-- V347 (WP-2169): 캘린더 사용자 설정(새 일정 기본 캘린더) + 기본 캘린더 이름 「Works 캘린더」.
-- 새 테이블만 더한다(롤링 배포 호환: 옛 코드는 이 테이블을 모른다).
--
-- calendar_user_setting: 테넌트·사용자마다 한 행(UNIQUE). 행이 없으면 서버가 Works(기본) 캘린더로 답한다.
--   - preferred_calendar_id: 새 일정의 기본 캘린더. 그 캘린더가 지워지면 NULL(→ Works 캘린더로 되돌아감).
-- V316(mail_user_setting)과 같은 RLS 정책 모양.

CREATE TABLE calendar_user_setting (
  id                     BIGSERIAL    PRIMARY KEY,
  tenant_id              BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  user_id                BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  preferred_calendar_id  BIGINT       NULL REFERENCES calendar(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- 한 사람이 여러 테넌트에 속할 수 있어 테넌트까지 키에 넣는다(테넌트마다 따로 한 행).
  CONSTRAINT uq_calendar_user_setting_tenant_user UNIQUE (tenant_id, user_id),
  CONSTRAINT fk_calendar_user_setting_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);

ALTER TABLE calendar_user_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_user_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_user_setting_tenant_isolation ON calendar_user_setting
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 기본 캘린더 이름 「기본」 → 「Works 캘린더」. 사용자가 이름을 바꾼 기본 캘린더(「기본」 이 아닌 것)와
-- 이름만 「기본」 인 일반 캘린더는 건드리지 않는다.
UPDATE calendar SET name = 'Works 캘린더', updated_at = now() WHERE is_default = true AND name = '기본';

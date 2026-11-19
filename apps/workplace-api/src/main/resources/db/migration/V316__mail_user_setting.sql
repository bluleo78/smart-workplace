-- V316 (WP-1744): 메일 사용자 설정 — 지금은 새 작성을 열 곳(작성 방식) 하나. 새 테이블만 더한다(롤링 배포 호환: 옛 코드는 이 테이블을 모른다).
--
-- mail_user_setting: 테넌트·사용자마다 한 행(UNIQUE). 행이 없으면 서버가 기본값 DOCK(우측 하단)으로 답한다.
--   - compose_mode: PANE(읽기 창) · DOCK(우측 하단) · WINDOW(새 창). 서버에 두어 새로 고침·다른 기기에서도 같게 연다.
-- V286(mail_signature)과 같은 RLS 정책 모양.

CREATE TABLE mail_user_setting (
  id            BIGSERIAL    PRIMARY KEY,
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  user_id       BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  compose_mode  VARCHAR(16)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_mail_user_setting_compose_mode CHECK (compose_mode IN ('PANE', 'DOCK', 'WINDOW')),
  -- 한 사람이 여러 테넌트에 속할 수 있어 테넌트까지 키에 넣는다(테넌트마다 따로 한 행).
  CONSTRAINT uq_mail_user_setting_tenant_user UNIQUE (tenant_id, user_id),
  CONSTRAINT fk_mail_user_setting_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);

ALTER TABLE mail_user_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_user_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_user_setting_tenant_isolation ON mail_user_setting
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

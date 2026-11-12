-- V286 (WP-1517): 메일 서명 — 사용자당 서명 한 행과 서명 이미지. 새 테이블만 더한다(롤링 배포 호환: 옛 코드는 이 테이블을 모른다).
--
-- mail_signature: 테넌트·사용자마다 한 행(UNIQUE). html 은 서버가 정리한 HTML, 빈 서명은 ''.
--   - auto_new: 새 메일에 자동으로 넣는다(기본 켬). auto_reply: 답장·전달에 자동으로 넣는다(기본 끔).
-- mail_signature_image: 서명 HTML 이 /api/v1/mail/signature/images/{id} 로 가리키는 이미지. 바이트는 디스크
--   tenant-*/mail-signature/ 에 둔다. 서명을 바꿔도 지우지 않는다 — 예전 임시저장이 옛 이미지를 가리킬 수 있다.
-- V282 와 같은 RLS 정책 모양.

CREATE TABLE mail_signature (
  id          BIGSERIAL    PRIMARY KEY,
  tenant_id   BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  user_id     BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  html        TEXT         NOT NULL DEFAULT '',
  auto_new    BOOLEAN      NOT NULL DEFAULT TRUE,
  auto_reply  BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- 한 사람이 여러 테넌트에 속할 수 있어 테넌트까지 키에 넣는다(테넌트마다 따로 한 행).
  CONSTRAINT uq_mail_signature_tenant_user UNIQUE (tenant_id, user_id),
  CONSTRAINT fk_mail_signature_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);

ALTER TABLE mail_signature ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_signature FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_signature_tenant_isolation ON mail_signature
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

CREATE TABLE mail_signature_image (
  id            BIGSERIAL    PRIMARY KEY,
  tenant_id     BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  user_id       BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  storage_path  VARCHAR(500) NOT NULL,
  mime_type     VARCHAR(50)  NOT NULL,
  size_bytes    INT          NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_mail_signature_image_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
CREATE INDEX idx_mail_signature_image_tenant_user ON mail_signature_image(tenant_id, user_id);

ALTER TABLE mail_signature_image ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_signature_image FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_signature_image_tenant_isolation ON mail_signature_image
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

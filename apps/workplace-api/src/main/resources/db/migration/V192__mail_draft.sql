-- WP-577: 메일 임시저장. 작성창 상태를 앱 DB 에만 둔다(IMAP·M365 Drafts 폴더와 동기화하지 않음).
-- 소유자(user_id)만 보고 고치고 지운다. 계정·사용자가 지워지면 FK CASCADE 로 함께 지워진다 — 묶인 업로드 파일은
-- 계정 purge(AccountPurgeService)가 하드 삭제 전에 만료시킨다(사용자 하드 삭제는 file.uploaded_by FK 가 먼저 막는다).
-- 새 표만 더하므로 구 파드에 영향이 없다(expand only).
CREATE TABLE mail_draft (
  id                BIGSERIAL    PRIMARY KEY,
  tenant_id         BIGINT       NOT NULL
                      DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                      REFERENCES tenant(id),
  user_id           BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  account_id        BIGINT       NOT NULL REFERENCES email_account(id) ON DELETE CASCADE,
  mode              VARCHAR(8)   NOT NULL DEFAULT 'new' CHECK (mode IN ('new','reply','forward')),
  -- 자동 저장이라 형식이 틀린 주소도 그대로 둔다(형식 검증은 발송 때만).
  to_addrs          TEXT[]       NOT NULL DEFAULT '{}',
  cc_addrs          TEXT[]       NOT NULL DEFAULT '{}',
  bcc_addrs         TEXT[]       NOT NULL DEFAULT '{}',
  subject           TEXT         NOT NULL DEFAULT '',
  body_html         TEXT         NOT NULL DEFAULT '',
  -- 목록 미리보기(본문 텍스트 앞 120자) — 목록이 body_html 을 읽지 않게 저장 때 만들어 둔다.
  preview           TEXT         NOT NULL DEFAULT '',
  -- 답장·전달의 원본 메일(email_message.id). 원본이 지워질 수 있어 FK 를 두지 않는다 — 웹이 인용을 다시 만들 때 조회가 404 면 생략한다.
  source_message_id BIGINT,
  quote_removed     BOOLEAN      NOT NULL DEFAULT false,
  -- 낙관적 잠금 — 저장할 때마다 1씩 오른다(다른 탭이 먼저 저장했으면 409 DRAFT_CONFLICT).
  version           INT          NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 목록·개수: 사용자·계정별. updated_at 은 넣지 않는다 — 자동 저장마다 바뀌어 인덱스를 다시 쓰게 되고(HOT 갱신 불가), 한 사람·계정의
-- 임시저장은 많아야 수백 건이라 목록의 최신순 정렬은 이 범위 안에서 DB 가 바로 한다.
CREATE INDEX idx_mail_draft_user_account ON mail_draft(user_id, account_id);
-- 계정 하드 삭제 CASCADE 용.
CREATE INDEX idx_mail_draft_account ON mail_draft(account_id);
CREATE INDEX idx_mail_draft_tenant ON mail_draft(tenant_id);

-- 임시저장에 묶인 작성 첨부 업로드(스테이징 FILE). 이슈 첨부처럼 정션으로 묶고, 묶는 동안 FILE 은 영구(expires_at NULL)라
-- 24시간 만료 스윕에 지워지지 않는다. 한 파일은 한 임시저장에만 묶인다(UNIQUE). 파일이 지워지면(만료 스윕) 행도 사라진다.
CREATE TABLE mail_draft_attachment (
  id          BIGSERIAL   PRIMARY KEY,
  tenant_id   BIGINT      NOT NULL
                DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                REFERENCES tenant(id),
  draft_id    BIGINT      NOT NULL REFERENCES mail_draft(id) ON DELETE CASCADE,
  file_id     BIGINT      NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_mail_draft_attachment_file ON mail_draft_attachment(file_id);
CREATE INDEX idx_mail_draft_attachment_draft ON mail_draft_attachment(draft_id);
CREATE INDEX idx_mail_draft_attachment_tenant ON mail_draft_attachment(tenant_id);

-- 임시저장의 전달 원본 첨부(받은 메일의 email_attachment) — id 참조만 둔다. 원본 메일이 지워지면 CASCADE 로 빠진다.
CREATE TABLE mail_draft_forward (
  id                  BIGSERIAL   PRIMARY KEY,
  tenant_id           BIGINT      NOT NULL
                        DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                        REFERENCES tenant(id),
  draft_id            BIGINT      NOT NULL REFERENCES mail_draft(id) ON DELETE CASCADE,
  email_attachment_id BIGINT      NOT NULL REFERENCES email_attachment(id) ON DELETE CASCADE,
  UNIQUE (draft_id, email_attachment_id)
);
-- email_attachment 삭제 CASCADE 용(계정 purge·동기화 정리).
CREATE INDEX idx_mail_draft_forward_attachment ON mail_draft_forward(email_attachment_id);
CREATE INDEX idx_mail_draft_forward_tenant ON mail_draft_forward(tenant_id);

-- RLS: V170·V182 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE mail_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_draft_tenant_isolation ON mail_draft
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_draft TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE mail_draft_id_seq TO app_tenant;

ALTER TABLE mail_draft_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_draft_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_draft_attachment_tenant_isolation ON mail_draft_attachment
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_draft_attachment TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE mail_draft_attachment_id_seq TO app_tenant;

ALTER TABLE mail_draft_forward ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_draft_forward FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_draft_forward_tenant_isolation ON mail_draft_forward
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_draft_forward TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE mail_draft_forward_id_seq TO app_tenant;

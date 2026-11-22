-- WP-1977 메일 계정별 작업 진행 상태: 동기화(SYNC)·휴지통 비우기(TRASH_EMPTY)의 진행을 DB 에 둔다.
-- 지금까지 JVM 메모리에 두던 진행 상태(MailSyncProgress·MailTrashEmptyProgress)는 파드가 여럿이거나 재기동되면 어긋난다.
-- 계정당 작업 종류별 한 행(PK) — 시작은 INSERT ... ON CONFLICT DO UPDATE ... WHERE 로 원자적으로 선점해 동시 시작 중 하나만 이긴다.
-- RUNNING 인데 updated_at 이 ttl 보다 오래되면 죽은 작업으로 보고 다른 파드가 이어받는다(만료 판정은 DB 시계로).
-- 실행 중인 파드는 주기적으로 하트비트를 보내 updated_at 을 갱신하므로, ttl 은 「파드가 죽은 뒤 막히는 시간」의 상한이다.
-- run_id 는 선점할 때마다 새로 발급하는 실행 토큰 — 진행 쓰기는 run_id 가 일치할 때만 적용해, 만료로 넘어간 뒤 옛 실행이 덮어쓰지 못하게 한다.
-- 계정 삭제 시 CASCADE. 새 테이블만 추가하는 expand-only 라 롤링 배포에 안전하다.
CREATE TABLE mail_account_job (
  tenant_id    BIGINT       NOT NULL
                 DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                 REFERENCES tenant(id),
  account_id   BIGINT       NOT NULL REFERENCES email_account(id) ON DELETE CASCADE,
  kind         VARCHAR(16)  NOT NULL,
  state        VARCHAR(16)  NOT NULL,
  phase        VARCHAR(16),
  total        INT,
  done         INT          NOT NULL DEFAULT 0,
  failed       INT          NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ  NOT NULL,
  finished_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ  NOT NULL,
  error_code   VARCHAR(64),
  run_id       UUID,
  PRIMARY KEY (account_id, kind),
  CONSTRAINT ck_mail_account_job_kind  CHECK (kind IN ('SYNC', 'TRASH_EMPTY')),
  CONSTRAINT ck_mail_account_job_state CHECK (state IN ('RUNNING', 'DONE', 'FAILED'))
);

-- RLS: wiki_page_star(V319) 와 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE mail_account_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_account_job FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_account_job_tenant_isolation ON mail_account_job
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON mail_account_job TO app_tenant;

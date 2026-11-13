-- WP-1539 「공유받은 항목」: 로그인한 같은 워크스페이스 사람이 사내(INTERNAL) 공유 링크를 처음 연 기록.
-- 드라이브 왼쪽 목록에서 그 링크로 연 파일을 다시 찾게 한다. 기록은 링크 단위(share_link_id)라 폴더 링크(WP-1538)가
-- 들어와도 이 표는 그대로 쓴다. 기록은 권한을 주지 않는다 — 열 때마다 링크 규칙(폐기·만료·비밀번호)으로 다시 판정한다.
-- token_encrypted: 이 사람이 연 링크 토큰의 AES-GCM 암호문(EncryptionService `iv:ciphertext`). WP-1528 이전에 만든 링크는
--   drive_share_link.token_encrypted 가 없어 다시 열기·복사를 못 하므로, 연 순간 받은 토큰을 이 행에 따로 둔다. 평문은 저장하지 않는다.
-- hidden_at: 「목록에서 빼기」 — 내 목록에서만 숨긴다. 같은 링크를 다시 열면 NULL 로 되돌린다.
-- 새 테이블만 추가하는 expand-only 라 롤링 배포에 안전하다.
CREATE TABLE drive_share_link_visit (
  id              BIGSERIAL   PRIMARY KEY,
  tenant_id       BIGINT      NOT NULL
                    DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                    REFERENCES tenant(id),
  user_id         BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  share_link_id   BIGINT      NOT NULL REFERENCES drive_share_link(id) ON DELETE CASCADE,
  token_encrypted TEXT,
  first_opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  hidden_at       TIMESTAMPTZ,
  -- upsert(ON CONFLICT) 대상 키 — 한 사람의 한 링크는 한 행.
  CONSTRAINT uq_drive_share_link_visit UNIQUE (user_id, share_link_id)
);
-- 내 목록(최근 연 순) 조회용.
CREATE INDEX idx_drive_share_link_visit_user_last ON drive_share_link_visit (user_id, last_opened_at DESC);
-- 링크 삭제 CASCADE 가 방문 행을 빨리 찾게.
CREATE INDEX idx_drive_share_link_visit_link ON drive_share_link_visit (share_link_id);

-- RLS: help_metric_daily(V291)·drive_share_link(V78) 와 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE drive_share_link_visit ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_share_link_visit FORCE ROW LEVEL SECURITY;
CREATE POLICY drive_share_link_visit_tenant_isolation ON drive_share_link_visit
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_share_link_visit TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE drive_share_link_visit_id_seq TO app_tenant;

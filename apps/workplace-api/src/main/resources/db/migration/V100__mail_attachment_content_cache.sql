-- 슬라이스③: 첨부 content 캐시 + dedup. 3층 토폴로지.
-- content_attachment = per-content 공유 manifest(메일당 1벌의 첨부 메타).
CREATE TABLE content_attachment (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  content_id     BIGINT NOT NULL REFERENCES email_content(id) ON DELETE CASCADE,
  ordinal        INT NOT NULL,                 -- content 내 첨부 위치(0-based, MIME DFS 순서)
  filename       VARCHAR(512),
  content_type   VARCHAR(255),
  size_bytes     BIGINT,
  mime_content_id VARCHAR(255),                 -- 인라인 이미지용 MIME cid (구 email_attachment.content_id)
  content_hash   VARCHAR(64),                   -- sha256 hex, 첫 다운로드 시 계산(불변). NULL=미계산
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_id, ordinal)
);
CREATE INDEX idx_content_attachment_content ON content_attachment(content_id);
CREATE INDEX idx_content_attachment_hash ON content_attachment(tenant_id, content_hash);

ALTER TABLE content_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY content_attachment_tenant_isolation ON content_attachment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- mail_attachment_blob = per-tenant-hash dedup 된 암호화 바이너리(디스크 file_ref 참조).
CREATE TABLE mail_attachment_blob (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  content_hash   VARCHAR(64) NOT NULL,          -- sha256 hex (평문 바이너리 기준)
  file_ref       VARCHAR(512) NOT NULL,         -- 암호화 blob 의 디스크 상대 경로
  size_bytes     BIGINT NOT NULL,               -- 평문 바이트 크기(메터링·knob 용)
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 슬라이딩 TTL 기준
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, content_hash)
);

ALTER TABLE mail_attachment_blob ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_attachment_blob FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_attachment_blob_tenant_isolation ON mail_attachment_blob
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- email_attachment(per-account 소유 anchor)에 manifest 링크 + 안정 ordinal 좌표.
ALTER TABLE email_attachment ADD COLUMN content_attachment_id BIGINT REFERENCES content_attachment(id) ON DELETE RESTRICT;
ALTER TABLE email_attachment ADD COLUMN ordinal INT;
CREATE INDEX idx_email_attachment_content_att ON email_attachment(content_attachment_id);

-- 백필 1: content 별 manifest 생성. (content_id, ordinal) 마다 1행 — canonical = 해당 위치 첨부 중 min(email_attachment.id).
-- ordinal 은 런타임 파생(message_id 내 id 오름차순 0-based)과 동일하게 ROW_NUMBER 로 계산.
-- 같은 content 의 서로 다른 envelope 가 같은 ordinal 에 같은 첨부를 가진다는 공유 가정에 따라, ordinal 별 첫 행에서 메타 복사.
WITH att_ord AS (
  SELECT
    ea.id AS att_id,
    em.content_id,
    em.tenant_id,
    ea.filename,
    ea.content_type,
    ea.size_bytes,
    ea.content_id AS mime_cid,
    (ROW_NUMBER() OVER (PARTITION BY ea.message_id ORDER BY ea.id) - 1) AS ord
  FROM email_attachment ea
  JOIN email_message em ON em.id = ea.message_id
  WHERE em.content_id IS NOT NULL
),
canonical AS (
  -- (content_id, ord) 그룹별 대표 1행
  SELECT DISTINCT ON (content_id, ord)
    content_id, tenant_id, ord, filename, content_type, size_bytes, mime_cid
  FROM att_ord
  ORDER BY content_id, ord, att_id
)
INSERT INTO content_attachment (tenant_id, content_id, ordinal, filename, content_type, size_bytes, mime_content_id)
SELECT tenant_id, content_id, ord, filename, content_type, size_bytes, mime_cid
FROM canonical;

-- 백필 2: email_attachment 의 ordinal 채우고 content_attachment 링크.
UPDATE email_attachment ea
SET ordinal = ao.ord,
    content_attachment_id = ca.id
FROM (
  SELECT ea2.id AS att_id, em.content_id,
         (ROW_NUMBER() OVER (PARTITION BY ea2.message_id ORDER BY ea2.id) - 1) AS ord
  FROM email_attachment ea2
  JOIN email_message em ON em.id = ea2.message_id
  WHERE em.content_id IS NOT NULL
) ao
JOIN content_attachment ca ON ca.content_id = ao.content_id AND ca.ordinal = ao.ord
WHERE ea.id = ao.att_id;

-- WP-874: 팀 채팅 메시지 링크 미리보기(Open Graph). 메시지 본문의 처음 서로 다른 URL 3개까지, 가져오기에 성공한(제목이 있는) 것만 저장한다.
-- 메타는 메시지 커밋 뒤 서버가 비동기로 가져와 채운다. position 은 본문에서 URL 이 나온 순서(0부터).
-- 새 표 + 기본값 있는 열 추가뿐이라 구 파드에 영향이 없다(expand only).

CREATE TABLE message_link_preview (
  tenant_id   BIGINT      NOT NULL
                DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                REFERENCES tenant(id),
  message_id  BIGINT      NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  position    SMALLINT    NOT NULL,
  url         TEXT        NOT NULL,
  title       TEXT,
  description TEXT,
  site_name   TEXT,
  -- 썸네일 원본 주소. 응답으로 내보내지 않고 이미지 프록시 엔드포인트만 쓴다(SSRF 가드를 다시 거쳐 가져온다).
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, position)
);
-- 목록 enrich 는 PK (message_id, position) 앞부분으로 탄다 — 따로 message_id 인덱스를 두지 않는다.
CREATE INDEX idx_message_link_preview_tenant ON message_link_preview (tenant_id);

-- RLS: V200 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE message_link_preview ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_link_preview FORCE ROW LEVEL SECURITY;
CREATE POLICY message_link_preview_tenant_isolation ON message_link_preview
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON message_link_preview TO app_tenant;

-- 보낸 사람이 미리보기를 지웠는지. true 면 이후 본문을 고쳐도 다시 만들지 않는다.
ALTER TABLE message ADD COLUMN link_previews_dismissed BOOLEAN NOT NULL DEFAULT false;

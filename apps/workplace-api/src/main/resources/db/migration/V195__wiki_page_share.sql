-- V195 (WP-579): 노트 페이지 링크 공유 스키마.
--
-- 1) wiki_page_share        — 페이지당 공유 하나(토큰·대상 범위·권한·하위 포함·만료·조회 수).
--    토큰은 평문 저장: 공유 창이 언제든 링크를 다시 복사해야 하고, DB 를 읽을 수 있는 공격자는 이미 페이지 본문을
--    읽을 수 있어 해시만 두는 이득이 작다. 외부(PUBLIC)는 보기 전용 — DB CHECK 로 못박는다.
-- 2) wiki_page_share_member — audience=PEOPLE 일 때 열 수 있는 사람 목록.
-- 3) wiki_page_share_event  — 공유 창 「공유 기록」. 공유를 해제해도 남아야 하므로 share 가 아니라 page 에 매단다.
-- 4) wiki_share_access_request — 지정한 사람이 아닌 사용자의 접근 요청. 페이지·요청자당 대기 중 하나.
-- 5) tenant.wiki_external_share_enabled — 관리자가 켜고 끄는 「외부 공유 허용」(기본 켬). tenant 는 RLS 비대상 전역 테이블.
-- 6) notification.wiki_page_id·message — 공유·접근 요청 알림이 노트를 가리키고, 보낸 사람의 메시지를 싣는다.
-- 7) 권한 wiki_share:manage — 기존 시스템 ADMIN 에 부여(V138 과 같은 SQL). 신규 테넌트는 TenantProvisioningService 가
--    ADMIN 에 전체 권한을 주므로 자동 포함된다.
-- 8) 비로그인 조회용 SECURITY DEFINER 함수 2개 — 소유자 app(BYPASSRLS) 소유라 GUC 없이 토큰으로 테넌트를 찾는다(V165 관례).
--
-- 9) 사용자 FK 는 사용자 행 하드 삭제(AGENT 삭제)를 막지 않게 ON DELETE 를 둔다(V177·V180·V182 관례) — 그 사람의 공유·지정·요청은 함께 지우고
--    (CASCADE), 기록의 행위자·결정한 사람·지정한 사람(added_by)은 비워 남긴다(SET NULL).
--
-- 롤링 배포 호환(expand): 새 테이블·새 컬럼(NULL 허용 또는 DEFAULT)만 더한다.

CREATE TABLE wiki_page_share (
  id               BIGSERIAL    PRIMARY KEY,
  tenant_id        BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                                REFERENCES tenant(id),
  page_id          BIGINT       NOT NULL UNIQUE REFERENCES wiki_page(id) ON DELETE CASCADE,  -- 페이지당 하나
  space_id         BIGINT       NOT NULL REFERENCES wiki_space(id) ON DELETE CASCADE,
  token            VARCHAR(64)  NOT NULL UNIQUE,                                              -- wsh_ + base62, 평문
  audience         VARCHAR(16)  NOT NULL,                                                     -- WORKSPACE | PEOPLE | PUBLIC
  permission       VARCHAR(8)   NOT NULL,                                                     -- VIEW | EDIT
  include_children BOOLEAN      NOT NULL DEFAULT false,
  expires_at       TIMESTAMPTZ,                                                               -- NULL = 만료 없음
  created_by       BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,          -- 만든 사람이 지워지면 공유도
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  view_count       BIGINT       NOT NULL DEFAULT 0,
  CONSTRAINT ck_wiki_page_share_audience CHECK (audience IN ('WORKSPACE', 'PEOPLE', 'PUBLIC')),
  CONSTRAINT ck_wiki_page_share_permission CHECK (permission IN ('VIEW', 'EDIT')),
  -- 외부(비로그인) 공개는 보기 전용
  CONSTRAINT ck_wiki_page_share_public_view CHECK (audience <> 'PUBLIC' OR permission = 'VIEW')
);
CREATE INDEX idx_wiki_page_share_tenant ON wiki_page_share(tenant_id);
CREATE INDEX idx_wiki_page_share_space ON wiki_page_share(space_id);
CREATE INDEX idx_wiki_page_share_created_by ON wiki_page_share(created_by);

CREATE TABLE wiki_page_share_member (
  share_id  BIGINT      NOT NULL REFERENCES wiki_page_share(id) ON DELETE CASCADE,
  user_id   BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                        REFERENCES tenant(id),
  added_by  BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,  -- NULL = 지운 사용자
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (share_id, user_id)
);
CREATE INDEX idx_wiki_page_share_member_tenant ON wiki_page_share_member(tenant_id);
CREATE INDEX idx_wiki_page_share_member_user ON wiki_page_share_member(user_id);

CREATE TABLE wiki_page_share_event (
  id         BIGSERIAL   PRIMARY KEY,
  tenant_id  BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                         REFERENCES tenant(id),
  page_id    BIGINT      NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,  -- 해제 뒤에도 남고, 페이지가 지워지면 함께 지워진다
  actor_id   BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,             -- NULL = 시스템·지운 사용자
  type       VARCHAR(32) NOT NULL,   -- CREATED, UPDATED, PEOPLE_ADDED, PEOPLE_REMOVED, REGENERATED, REVOKED, REVOKED_BY_POLICY,
                                     -- REVOKED_BY_ADMIN, REVOKED_BY_MEMBERSHIP, PAGE_MOVED_IN, PAGE_MOVED_OUT,
                                     -- ACCESS_REQUESTED, ACCESS_APPROVED, ACCESS_DENIED
  detail     JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wiki_page_share_event_tenant ON wiki_page_share_event(tenant_id);
CREATE INDEX idx_wiki_page_share_event_page ON wiki_page_share_event(page_id, created_at DESC);

CREATE TABLE wiki_share_access_request (
  id           BIGSERIAL   PRIMARY KEY,
  tenant_id    BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                           REFERENCES tenant(id),
  page_id      BIGINT      NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  requester_id BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status       VARCHAR(16) NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | DENIED
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by   BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  CONSTRAINT ck_wiki_share_access_request_status CHECK (status IN ('PENDING', 'APPROVED', 'DENIED'))
);
CREATE INDEX idx_wiki_share_access_request_tenant ON wiki_share_access_request(tenant_id);
-- 페이지·요청자당 대기 중 요청은 하나
CREATE UNIQUE INDEX uq_wiki_share_access_request_pending
  ON wiki_share_access_request(page_id, requester_id) WHERE status = 'PENDING';
-- 거절 뒤 재요청 대기(24시간) 판정 — 이 사람의 이 페이지 거절만 찾는다(403 응답·접근 요청이 요청마다 본다).
CREATE INDEX idx_wiki_share_access_request_denied
  ON wiki_share_access_request(page_id, requester_id) WHERE status = 'DENIED';

-- RLS: V68 패턴(NULLIF fail-closed). GUC 미설정/빈 문자열 → NULL → 어떤 행과도 매칭 안 됨. 소유자 롤(app)은 BYPASSRLS.
ALTER TABLE wiki_page_share ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_share_tenant_isolation ON wiki_page_share
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

ALTER TABLE wiki_page_share_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_share_member_tenant_isolation ON wiki_page_share_member
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

ALTER TABLE wiki_page_share_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_page_share_event_tenant_isolation ON wiki_page_share_event
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

ALTER TABLE wiki_share_access_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_share_access_request_tenant_isolation ON wiki_share_access_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- 런타임 롤 권한(V44 의 ALTER DEFAULT PRIVILEGES 로도 부여되나 V78 처럼 명시한다).
GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_page_share TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_page_share_member TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_page_share_event TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_share_access_request TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE wiki_page_share_id_seq TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE wiki_page_share_event_id_seq TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE wiki_share_access_request_id_seq TO app_tenant;

-- 관리자 「외부 공유 허용」 스위치. 기본 켬(외부 링크는 공유 창에서 건건이 만들어야 생긴다).
ALTER TABLE tenant ADD COLUMN wiki_external_share_enabled BOOLEAN NOT NULL DEFAULT true;

-- 알림이 노트를 가리키고(링크 = 그 페이지), 공유한 사람의 메시지를 싣는다. 둘 다 NULL 허용.
ALTER TABLE notification ADD COLUMN wiki_page_id BIGINT REFERENCES wiki_page(id) ON DELETE CASCADE;
ALTER TABLE notification ADD COLUMN message TEXT;
-- 페이지 삭제의 ON DELETE CASCADE 가 notification 을 훑지 않게 — 노트 알림 행만 담는 부분 인덱스.
CREATE INDEX idx_notification_wiki_page ON notification(wiki_page_id) WHERE wiki_page_id IS NOT NULL;

-- 권한 wiki_share:manage — 기존 시스템 ADMIN 역할에 부여(V138 패턴).
INSERT INTO permission (code, description, category)
VALUES ('wiki_share:manage', '노트 공유 관리', 'wiki')
ON CONFLICT (code) DO NOTHING;

-- role/role_permission 은 RLS ENABLE(미-FORCE) — Flyway 소유자 롤은 BYPASSRLS. tenant_id 는 role 에서 가져와 명시(V132 패턴).
INSERT INTO role_permission (role_id, permission_id, tenant_id)
SELECT r.id, p.id, r.tenant_id
FROM role r
JOIN permission p ON p.code = 'wiki_share:manage'
WHERE r.name = 'ADMIN'
  AND r.is_system = true
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 외부(비로그인) 조회 전용: 토큰으로 tenant_id·page_id 등을 찾는다. 테넌트 컨텍스트(GUC)가 없으므로 소유자 app(BYPASSRLS)
-- 소유 SECURITY DEFINER 로 RLS 를 우회한다. PUBLIC 이고, 테넌트 정책이 켜져 있고, 만료 전일 때만 행을 돌려준다.
CREATE FUNCTION wiki_page_share_resolve_public(p_token TEXT)
RETURNS TABLE(tenant_id BIGINT, page_id BIGINT, include_children BOOLEAN, expires_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.tenant_id, s.page_id, s.include_children, s.expires_at
  FROM wiki_page_share s
  JOIN tenant t ON t.id = s.tenant_id
  WHERE s.token = p_token
    AND s.audience = 'PUBLIC'
    AND t.wiki_external_share_enabled
    AND (s.expires_at IS NULL OR s.expires_at > now()) $$;
-- 함수는 기본으로 PUBLIC 에 EXECUTE 가 열린다 — 쓰는 롤(app_tenant)에만 준다(V163 관례).
REVOKE ALL ON FUNCTION wiki_page_share_resolve_public(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wiki_page_share_resolve_public(TEXT) TO app_tenant;

-- 로그인 사용자용: 다른 워크스페이스의 링크를 열면 그 테넌트로 자동 전환해야 하므로, audience·만료와 무관하게 tenant_id 만 돌려준다.
-- (열 수 있는지는 이후 그 테넌트 컨텍스트에서 다시 판정한다.)
CREATE FUNCTION wiki_page_share_tenant(p_token TEXT)
RETURNS BIGINT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.tenant_id FROM wiki_page_share s WHERE s.token = p_token $$;
REVOKE ALL ON FUNCTION wiki_page_share_tenant(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wiki_page_share_tenant(TEXT) TO app_tenant;

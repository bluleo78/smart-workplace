-- WP-714·715: 캘린더 태그 — 사용자별 분류 표시와 일정 연결, 태그별 구독 주소(iCal 피드) 토큰.
-- 태그는 사람마다 따로다(같은 일정이라도 내 태그는 나만 본다). Outlook 범주 이름 = 태그 이름이라 이름은 사용자 안에서 대소문자 무시 유일.
-- 새 표·새 함수만 더하므로 구 파드에 영향이 없다(expand only).

CREATE TABLE calendar_tag (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       BIGINT       NOT NULL
                    DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                    REFERENCES tenant(id),
  user_id         BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- API 는 1~50자로 받지만 Outlook 범주 이름은 더 길 수 있어 동기화가 그대로 넣도록 255 까지 둔다.
  name            VARCHAR(255) NOT NULL,
  color           VARCHAR(20)  NOT NULL,          -- 팔레트 키(blue … gray) — CalendarPalette
  -- WP-715 구독 주소 토큰(32바이트 난수 base64url). 다시 보여 줘야 해서 원문 저장, 재발급으로 막는다. NULL = 주소 없음.
  feed_token      VARCHAR(64)  UNIQUE,
  feed_created_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 이름 유일: 사용자 안에서 대소문자 무시. user 는 전역 표라(한 사람이 여러 워크스페이스) tenant_id 를 키에 넣는다 —
-- 유니크 인덱스는 RLS 를 우회해 전 테넌트에 걸리므로 빠뜨리면 다른 워크스페이스의 같은 이름과 부딪힌다(V58 과 같은 이유).
CREATE UNIQUE INDEX uq_calendar_tag_user_name ON calendar_tag (tenant_id, user_id, lower(name));
CREATE INDEX idx_calendar_tag_tenant ON calendar_tag (tenant_id);

-- 일정-태그 연결. 태그가 사용자 것이라 연결도 그 사용자 것이다. source: APP = 앱에서 붙임, OUTLOOK = Outlook 범주 동기화.
CREATE TABLE calendar_event_tag (
  tag_id     BIGINT      NOT NULL REFERENCES calendar_tag(id) ON DELETE CASCADE,
  event_id   BIGINT      NOT NULL REFERENCES calendar_event(id) ON DELETE CASCADE,
  source     VARCHAR(10) NOT NULL CHECK (source IN ('APP', 'OUTLOOK')),
  tenant_id  BIGINT      NOT NULL
               DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
               REFERENCES tenant(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, event_id)
);
-- 일정 → 태그 조회(목록·상세 응답, 동기화 연결 갱신)·일정 삭제 CASCADE 용
CREATE INDEX idx_calendar_event_tag_event ON calendar_event_tag (event_id);
CREATE INDEX idx_calendar_event_tag_tenant ON calendar_event_tag (tenant_id);

-- RLS: V182·V192 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE calendar_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_tag_tenant_isolation ON calendar_tag
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_tag TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE calendar_tag_id_seq TO app_tenant;

ALTER TABLE calendar_event_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_event_tag_tenant_isolation ON calendar_event_tag
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_event_tag TO app_tenant;

-- WP-715 공개 구독 주소 resolve 전용(테넌트 컨텍스트 없음): 소유자 app(BYPASSRLS) 소유 SECURITY DEFINER 로 RLS 를 우회해
-- 토큰 → 태그·테넌트·주인을 찾는다. 찾은 뒤의 일정 조회는 그 테넌트 컨텍스트에서 보통 경로로 한다(V182 관례).
CREATE FUNCTION calendar_tag_feed_resolve(p_token VARCHAR)
RETURNS TABLE(id BIGINT, tenant_id BIGINT, user_id BIGINT, name VARCHAR)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.tenant_id, t.user_id, t.name FROM calendar_tag t WHERE t.feed_token = p_token $$;
-- 함수는 기본으로 PUBLIC 에 EXECUTE 가 열린다 — 쓰는 롤(app_tenant)에만 준다(V163 관례).
REVOKE ALL ON FUNCTION calendar_tag_feed_resolve(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendar_tag_feed_resolve(VARCHAR) TO app_tenant;

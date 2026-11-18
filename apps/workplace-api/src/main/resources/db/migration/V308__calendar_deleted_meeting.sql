-- WP-1734: 내가 지운 동기화 미팅 기억 — 같은 미팅(같은 iCalUID)의 동료·주최자 동기화 사본이 내 달력에 다시 나타나지 않게 한다.
-- 동기화 일정을 지우면(Graph DELETE + 로컬 행 삭제) 내 사본이 사라져, 목록의 크로스소스 정리(WP-871)가 「내 사본 없음」으로 보고 남의 사본을
-- 한 장 보여 줬다. 주최자가 지운 회차는 동료 계정이 동기화될 때까지(~10분), 참석자로 지운 미팅은 주최자 사본이 남아 있는 한 계속 보였다.
-- 동기화 일정은 회차마다 iCalUID 가 달라서 (사용자, iCalUID) 를 기억하면 지운 그 회차만 가린다.
-- 새 표만 더하므로 구 파드에 영향이 없다(expand only).

CREATE TABLE calendar_deleted_meeting (
  id         BIGSERIAL    PRIMARY KEY,
  tenant_id  BIGINT       NOT NULL
               DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
               REFERENCES tenant(id),
  user_id    BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- calendar_event.ical_uid 와 같은 형식(V123) — 지운 회차의 iCalUID
  ical_uid   VARCHAR(500) NOT NULL,
  -- 지운 미팅의 끝 시각 — 이 시각이 한참 지난 기억은 정리한다(보존 기간은 DeletedMeetingRepository)
  ends_at    TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 사용자당 iCalUID 하나(다시 지우면 upsert). user 는 전역 표라 tenant_id 를 키에 넣는다 — 유니크 인덱스는 RLS 를 우회해 전 테넌트에
-- 걸리므로 빠뜨리면 다른 워크스페이스의 같은 미팅 기억과 부딪힌다(V197 과 같은 이유). 목록 조회((user_id, ical_uid IN …))도 이 인덱스를 쓴다.
CREATE UNIQUE INDEX uq_calendar_deleted_meeting_user_uid
  ON calendar_deleted_meeting (tenant_id, user_id, ical_uid);
CREATE INDEX idx_calendar_deleted_meeting_tenant ON calendar_deleted_meeting (tenant_id);

-- RLS: V197 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE calendar_deleted_meeting ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_deleted_meeting FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_deleted_meeting_tenant_isolation ON calendar_deleted_meeting
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_deleted_meeting TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE calendar_deleted_meeting_id_seq TO app_tenant;

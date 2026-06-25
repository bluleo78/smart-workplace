-- 일정 참석자: 주최자(ORGANIZER) 본인 행 포함. owner_id는 calendar_event에 그대로 유지(편집 권한용).
-- RFC5545/Google API 모델: 주최자도 참석자 행으로 함께 둔다(참석자 목록 단일 쿼리).
CREATE TABLE event_attendee (
    id                 BIGSERIAL   PRIMARY KEY,
    event_id           BIGINT      NOT NULL REFERENCES calendar_event(id) ON DELETE CASCADE,
    user_id            BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    invited_by_user_id BIGINT      REFERENCES "user"(id),          -- 주최자 본인 행은 NULL
    role               VARCHAR(16) NOT NULL DEFAULT 'ATTENDEE',    -- ORGANIZER | ATTENDEE
    rsvp_status        VARCHAR(16) NOT NULL DEFAULT 'NEEDS_ACTION',-- NEEDS_ACTION|ACCEPTED|DECLINED|TENTATIVE
    invited_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at       TIMESTAMPTZ,
    -- tenant_id: 런타임 INSERT 시 GUC가 자동으로 채움(애플리케이션은 명시 안 함)
    tenant_id          BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
    CONSTRAINT event_attendee_uq UNIQUE (event_id, user_id),
    CONSTRAINT fk_event_attendee_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);

CREATE INDEX idx_event_attendee_event ON event_attendee(event_id);
CREATE INDEX idx_event_attendee_user  ON event_attendee(user_id);
CREATE INDEX idx_event_attendee_tenant ON event_attendee(tenant_id);

-- RLS: 테넌트 격리(FORCE — 소유자 롤 외 모든 런타임 접근에 강제)
ALTER TABLE event_attendee ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendee FORCE ROW LEVEL SECURITY;
CREATE POLICY event_attendee_tenant_isolation ON event_attendee
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

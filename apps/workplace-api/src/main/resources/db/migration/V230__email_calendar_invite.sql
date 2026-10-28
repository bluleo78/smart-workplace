-- WP-986: 메일 화면에서 일정 초대에 바로 응답.
-- 본문을 적재할 때 메일의 iCalendar(text/calendar 파트·.ics 첨부, Graph 는 원문 MIME)를 읽어 초대(METHOD:REQUEST)·취소(METHOD:CANCEL)를
-- 메일(envelope) 단위로 저장한다. 내 응답(my_response)은 사람마다 다르므로 공유 content 가 아니라 envelope 에 붙인다.
-- 새 표 + nullable 열 추가뿐이라 구 파드에 영향이 없다(expand only).

CREATE TABLE email_calendar_invite (
  message_id      BIGINT       PRIMARY KEY REFERENCES email_message(id) ON DELETE CASCADE,
  tenant_id       BIGINT       NOT NULL
                    DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                    REFERENCES tenant(id),
  method          VARCHAR(16)  NOT NULL,              -- REQUEST | CANCEL
  uid             VARCHAR(500) NOT NULL,              -- iCalendar UID — 같은 미팅의 메일·일정을 잇는 키
  sequence        INT          NOT NULL DEFAULT 0,    -- iCalendar SEQUENCE — 더 큰 값을 알면 이 메일은 낡은 초대
  summary         VARCHAR(500),
  starts_at       TIMESTAMPTZ  NOT NULL,
  ends_at         TIMESTAMPTZ,
  all_day         BOOLEAN      NOT NULL DEFAULT FALSE,
  location        VARCHAR(500),
  organizer_email VARCHAR(320),
  organizer_name  VARCHAR(255),
  -- 참석자 이메일(소문자) — 「내가 참석자인가」 판정과 참석자 수에 쓴다
  attendee_emails TEXT[]       NOT NULL DEFAULT '{}',
  -- 이 메일에서 마지막으로 보낸 내 응답(ACCEPTED|TENTATIVE|DECLINED). 캘린더 일정이 없을 때(거절 등) 카드가 이 값을 보인다
  my_response     VARCHAR(16),
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 같은 UID 의 다른 메일(더 최신 SEQUENCE) 찾기
CREATE INDEX idx_email_calendar_invite_uid ON email_calendar_invite (uid);
CREATE INDEX idx_email_calendar_invite_tenant ON email_calendar_invite (tenant_id);

-- RLS: V205 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE email_calendar_invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_calendar_invite FORCE ROW LEVEL SECURITY;
CREATE POLICY email_calendar_invite_tenant_isolation ON email_calendar_invite
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON email_calendar_invite TO app_tenant;

-- 메일 초대로 넣은 일정의 iCalendar SEQUENCE — 옛 초대 메일 판정과 옛 취소 메일 무시에 쓴다(동기화 일정은 NULL).
ALTER TABLE calendar_event ADD COLUMN ical_sequence INT;
-- 주최자가 취소한 일정(METHOD:CANCEL 메일). NULL 이면 취소되지 않음.
ALTER TABLE calendar_event ADD COLUMN cancelled_at TIMESTAMPTZ;
-- 메일 초대로 넣은 앱 일정(external_id 없음, ical_sequence 있음 — 이 표시는 메일 초대 일정만 단다)은 사용자(주인)당 UID 하나 — 같은 초대에
-- 동시에 두 번 수락해도 일정이 하나만 생긴다(INSERT ... ON CONFLICT DO NOTHING 후 다시 읽어 고친다). ical_sequence 는 위에서 새로 만든 열이라
-- 기존 행은 모두 NULL — 기존 일정(동기화 사본·반복 회차 등 같은 UID 를 나눠 쓰는 행)과 충돌하지 않는다.
CREATE UNIQUE INDEX uq_calendar_event_owner_ical_uid_local
  ON calendar_event (owner_id, ical_uid)
  WHERE external_id IS NULL AND ical_sequence IS NOT NULL;

-- WP-1701 일정(반복이면 회차)에 회의록 노트를 하나 잇는 연결 표. 새 표만 더하는 expand-only 라 롤링 배포에 안전하다(구 코드는 이 표를 모른다).
-- event_id: 반복이면 마스터 id, 그 밖엔 그 일정 행 id(외부 달력 M365 회차 행 포함).
-- occurrence_start: 우리 반복 일정 회차의 "원래" 시작 시각 = calendar_event_exception.occurrence_date 와 같은 뜻. 반복 아님·M365 회차는 NULL.
-- 노트·일정을 지우면 연결도 CASCADE 로 사라진다. 노트 본문·참조(wiki_reference)에는 넣지 않는다.
-- 주의: 외래 키 검사는 RLS 를 거치지 않아 다른 테넌트의 wiki_page_id 도 DB 는 받아 준다 — 잇기 전에 노트 읽기 판정을 반드시 거친다(서비스 책임).
CREATE TABLE calendar_event_note (
  id               BIGSERIAL   PRIMARY KEY,
  tenant_id        BIGINT      NOT NULL
                     DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                     REFERENCES tenant(id),
  event_id         BIGINT      NOT NULL REFERENCES calendar_event(id) ON DELETE CASCADE,
  occurrence_start TIMESTAMPTZ NULL,
  wiki_page_id     BIGINT      NOT NULL REFERENCES wiki_page(id) ON DELETE CASCADE,
  linked_by        BIGINT      NULL REFERENCES "user"(id) ON DELETE SET NULL,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 일정·회차당 한 줄. NULL 은 UNIQUE 에서 서로 다른 값이라 NULL 슬롯은 별도 부분 인덱스로 막는다.
CREATE UNIQUE INDEX uq_calendar_event_note_occurrence
  ON calendar_event_note (event_id, occurrence_start) WHERE occurrence_start IS NOT NULL;
CREATE UNIQUE INDEX uq_calendar_event_note_single
  ON calendar_event_note (event_id) WHERE occurrence_start IS NULL;
-- 노트 삭제 CASCADE 와 「노트 → 일정」 조회용.
CREATE INDEX idx_calendar_event_note_page ON calendar_event_note (wiki_page_id);
CREATE INDEX idx_calendar_event_note_tenant ON calendar_event_note (tenant_id);

-- RLS: V197 과 같은 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE calendar_event_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_note FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_event_note_tenant_isolation ON calendar_event_note
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_event_note TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE calendar_event_note_id_seq TO app_tenant;

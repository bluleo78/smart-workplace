-- 개인 캘린더(컨테이너): 사용자가 여러 캘린더를 만들고 캘린더별 색을 지정. 일정은 소속 캘린더 색을 상속(override 가능).
-- calendar_id 는 우선 NULLABLE 로 추가하고 백필 — NOT NULL 확정은 코드 배선 후 V104.
CREATE TABLE calendar (
    id          BIGSERIAL    PRIMARY KEY,
    owner_id    BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(32)  NOT NULL,                       -- 팔레트 키(blue 등)
    is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
    position    INT          NOT NULL DEFAULT 0,
    -- tenant_id: 런타임 INSERT 시 GUC 가 자동으로 채움(애플리케이션은 명시 안 함)
    tenant_id   BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_calendar_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);

CREATE INDEX idx_calendar_owner  ON calendar (owner_id, position);
CREATE INDEX idx_calendar_tenant ON calendar (tenant_id);
-- 소유자(테넌트별)당 기본 캘린더 정확히 1개 — 백필 조인 명확성 + 삭제불가/이동 불변식의 토대.
CREATE UNIQUE INDEX uq_calendar_default ON calendar (owner_id, tenant_id) WHERE is_default;

ALTER TABLE calendar_event ADD COLUMN calendar_id BIGINT REFERENCES calendar(id);
CREATE INDEX idx_calendar_event_calendar ON calendar_event (calendar_id);

-- 데이터 마이그레이션: 기존 일정 owner+tenant 별 기본 캘린더 생성 후 전 일정 calendar_id 백필.
-- tenant_id 는 명시(마이그레이션 실행 컨텍스트엔 GUC 가 없어 DEFAULT 가 NULL 이 되므로).
INSERT INTO calendar (owner_id, name, color, is_default, position, tenant_id)
SELECT DISTINCT owner_id, '기본', 'blue', true, 0, tenant_id FROM calendar_event;

UPDATE calendar_event e
   SET calendar_id = c.id
  FROM calendar c
 WHERE c.owner_id = e.owner_id AND c.tenant_id = e.tenant_id AND c.is_default;

-- RLS: V59 표준 fail-closed + FORCE. 마이그레이션은 소유자 롤(BYPASSRLS)이라 같은 V103 안전.
ALTER TABLE calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar FORCE  ROW LEVEL SECURITY;
CREATE POLICY calendar_tenant_isolation ON calendar
  USING       (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK  (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

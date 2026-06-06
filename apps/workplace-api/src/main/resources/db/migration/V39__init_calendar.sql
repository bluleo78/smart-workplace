-- 캘린더 단일 일정. owner=생성자(개인 일정). 시간은 timestamptz(UTC) 저장.
CREATE TABLE calendar_event (
    id          BIGSERIAL   PRIMARY KEY,
    owner_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    all_day     BOOLEAN     NOT NULL DEFAULT FALSE,
    location    VARCHAR(200),
    color       VARCHAR(32),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT calendar_event_time_check CHECK (ends_at > starts_at)
);

CREATE INDEX idx_calendar_event_owner_range ON calendar_event (owner_id, starts_at, ends_at);

INSERT INTO permission (code, description, category) VALUES
    ('calendar:read',  '캘린더 일정 조회',          'calendar'),
    ('calendar:write', '캘린더 일정 생성/수정/삭제', 'calendar');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.name = 'ADMIN' AND p.code IN ('calendar:read', 'calendar:write');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.name = 'USER' AND p.code IN ('calendar:read', 'calendar:write');

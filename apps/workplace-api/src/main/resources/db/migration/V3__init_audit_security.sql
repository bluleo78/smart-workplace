-- V3: 보안/감사 인프라
-- audit_log: 사용자 행위 감사 로그
-- login_attempts: 로그인 실패 카운터 (브루트포스 방어)

CREATE TABLE audit_log (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       REFERENCES "user"(id),
    username      VARCHAR(50)  NOT NULL,
    action_type   VARCHAR(50)  NOT NULL,
    resource      VARCHAR(50)  NOT NULL,
    resource_id   VARCHAR(100),
    description   TEXT,
    action_time   TIMESTAMP    NOT NULL DEFAULT NOW(),
    ip_address    VARCHAR(45),
    user_agent    TEXT,
    result        VARCHAR(20)  NOT NULL DEFAULT 'SUCCESS',
    error_message TEXT,
    metadata      JSONB
);

CREATE INDEX idx_audit_log_resource    ON audit_log(resource, resource_id);
CREATE INDEX idx_audit_log_user        ON audit_log(user_id);
CREATE INDEX idx_audit_log_action_time ON audit_log(action_time);
CREATE INDEX idx_audit_log_action_type ON audit_log(action_type);

-- 로그인 실패 카운터 (영속 — 재시작/멀티 인스턴스 환경에서 일관)
CREATE TABLE login_attempts (
    username    VARCHAR(255) PRIMARY KEY,
    attempts    INT          NOT NULL CHECK (attempts > 0),
    expires_at  TIMESTAMP    NOT NULL,
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_expires_at ON login_attempts(expires_at);

COMMENT ON TABLE audit_log      IS '사용자 행위 감사 로그';
COMMENT ON TABLE login_attempts IS '로그인 실패 카운터 (브루트포스 방어)';

-- V121: 공유 링크 비밀번호 브루트포스 방어 (#700)
-- drive_share_link_attempts: 공유 링크 비밀번호 실패 카운터. login_attempts(V3)와 동일 패턴,
-- 키만 username 대신 token_hash(공유 토큰의 SHA-256 hex) 사용.

CREATE TABLE drive_share_link_attempts (
    token_hash  VARCHAR(64) PRIMARY KEY,
    attempts    INT         NOT NULL CHECK (attempts > 0),
    expires_at  TIMESTAMP   NOT NULL,
    updated_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drive_share_link_attempts_expires_at ON drive_share_link_attempts(expires_at);

COMMENT ON TABLE drive_share_link_attempts IS '공유 링크 비밀번호 실패 카운터 (브루트포스 방어, #700)';

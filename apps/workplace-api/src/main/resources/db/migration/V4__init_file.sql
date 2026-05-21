-- V4: 파일 업로드 메타 인프라
-- 바이너리는 storage_path 가 가리키는 위치(로컬 디스크/오브젝트 스토리지)에 별도 저장.
-- expires_at nullable: 영구 파일(아바타·위키 첨부 등) 지원.

CREATE TABLE file (
    id              BIGSERIAL    PRIMARY KEY,
    original_name   VARCHAR(255) NOT NULL,
    stored_name     VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    size_bytes      BIGINT       NOT NULL,
    category        VARCHAR(20),
    storage_path    VARCHAR(500) NOT NULL,
    uploaded_by     BIGINT       NOT NULL REFERENCES "user"(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX idx_file_uploaded_by ON file(uploaded_by);
CREATE INDEX idx_file_expires_at  ON file(expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE file IS '업로드 파일 메타데이터';

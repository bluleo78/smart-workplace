-- WP-883·884: 이슈 가져오기(관리자 전용) — 가져온 행을 표시하고, 같은 원본을 두 번 가져오지 않도록 원본 키를 둔다.
-- 모두 NULL 허용 컬럼 추가라 구 버전 앱은 새 컬럼을 쓰지 않을 뿐 그대로 동작한다(롤링 배포 안전).
-- imported_by: 가져오기를 실행한 사용자(원작성자와 별개). 사용자 삭제 시 표시만 지운다(SET NULL).
-- import_source_key: 원본 시스템의 이슈 키(예: CLIM-17). 프로젝트 안에서 값이 있을 때만 고유.
ALTER TABLE issue
    ADD COLUMN imported_by       BIGINT       NULL REFERENCES "user"(id) ON DELETE SET NULL,
    ADD COLUMN imported_at       TIMESTAMPTZ  NULL,
    ADD COLUMN import_source_key VARCHAR(100) NULL;

ALTER TABLE issue_comment
    ADD COLUMN imported_by BIGINT      NULL REFERENCES "user"(id) ON DELETE SET NULL,
    ADD COLUMN imported_at TIMESTAMPTZ NULL;

-- 부분 고유 인덱스: 일반 이슈(키 없음)는 제약을 받지 않는다.
CREATE UNIQUE INDEX uq_issue_project_import_source_key
    ON issue (project_id, import_source_key)
    WHERE import_source_key IS NOT NULL;

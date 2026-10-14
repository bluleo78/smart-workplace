-- V177__label_created_by.sql (WP-394)
-- 라벨을 만든 사람. 프로젝트 멤버도 라벨을 만들 수 있게 되면서, 수정·삭제는 OWNER 또는 만든 사람에게 허용한다.
-- 기존 라벨은 만든 사람 기록이 없어 NULL — 지금처럼 OWNER 만 수정·삭제한다.
-- expand 단계: nullable 추가만 하므로 구 버전 코드(컬럼을 모름)와 공존 가능. 사용자 삭제 시 기록만 지운다(라벨은 남김).
ALTER TABLE label ADD COLUMN created_by BIGINT REFERENCES "user"(id) ON DELETE SET NULL;

-- 외부(M365 Graph) 참석자 지원을 위한 event_attendee 스키마 확장.
-- user_id nullable → 외부 이메일 참석자 행 허용.

-- user_id nullable 변경
ALTER TABLE event_attendee ALTER COLUMN user_id DROP NOT NULL;

-- 외부 참석자 식별 정보
ALTER TABLE event_attendee ADD COLUMN external_email VARCHAR(320);
ALTER TABLE event_attendee ADD COLUMN external_name  VARCHAR(255);

-- 기존 event_attendee_uq UNIQUE(event_id, user_id) 유지.
-- user_id nullable 이후에도 PostgreSQL NULLS DISTINCT 로 외부 행(user_id=NULL) 은 서로 충돌 안 함.
-- ON CONFLICT(event_id, user_id) 가 이 named constraint 를 타깃으로 하므로 절대 삭제 금지.

-- 외부 참석자 partial unique (external_email 있는 행만)
CREATE UNIQUE INDEX event_attendee_external_uq
    ON event_attendee (event_id, external_email) WHERE external_email IS NOT NULL;

-- 반드시 user_id 또는 external_email 중 정확히 하나 존재
ALTER TABLE event_attendee
    ADD CONSTRAINT event_attendee_identity_check
    CHECK ((user_id IS NOT NULL AND external_email IS NULL)
        OR (user_id IS NULL AND external_email IS NOT NULL));

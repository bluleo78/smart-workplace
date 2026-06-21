-- V80: 드라이브 용량 쿼터 — 테넌트 단위 저장 한도(#81)
-- 사용량 집계는 드라이브 저장량만(drive_file 조인), 한도는 테넌트별로 둔다.
-- (#80 의 V79__drive_file_ref 와 독립 — 컬럼 추가만, 다른 테이블 무영향)
ALTER TABLE tenant
    ADD COLUMN quota_bytes BIGINT NOT NULL DEFAULT 10737418240;  -- 기본 10 GB

COMMENT ON COLUMN tenant.quota_bytes IS '드라이브 저장 한도(바이트). 기본 10GB.';

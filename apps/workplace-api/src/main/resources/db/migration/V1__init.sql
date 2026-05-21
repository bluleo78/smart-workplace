-- V1: 초기 셋업
-- 도메인 테이블은 후속 마이그레이션(V2~)에서 추가.

-- UUID 생성 함수 (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 대소문자 무시 텍스트 (예: 이메일 유니크 인덱스)
CREATE EXTENSION IF NOT EXISTS citext;

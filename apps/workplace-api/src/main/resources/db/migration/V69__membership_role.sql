-- V69: membership 에 테넌트 내 역할(role) 추가 (P5 운영자 콘솔 — 초기 Owner 지정).
-- 기존 행은 MEMBER 로 백필(DEFAULT). 운영자 콘솔의 테넌트 생성 흐름이 초기 소유자에게 OWNER 를 부여한다.
-- membership 은 전역(RLS 비대상) 컨트롤 플레인 테이블이라 RLS 정책 변경 없음.
-- 참고: 작업 명세는 V67 로 기술됐으나 V67/V68 이 wiki 마이그레이션으로 선점되어 V69 로 부여.
ALTER TABLE membership
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'MEMBER';

ALTER TABLE membership
  ADD CONSTRAINT membership_role_check CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER'));

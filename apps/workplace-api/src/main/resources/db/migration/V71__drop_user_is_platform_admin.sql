-- is_platform_admin 컬럼 제거.
-- 운영자 권한 게이트는 #240(V70)에서 역할 기반 RBAC(platform_user_role/SUPER_ADMIN)로 전환됨.
-- 코드는 더 이상 이 컬럼을 읽지 않으며(유일 참조였던 UserRepository.isPlatformAdmin 삭제),
-- V70 백필이 기존 is_platform_admin=TRUE 사용자를 SUPER_ADMIN 으로 이관 완료 → 이제 안전하게 제거한다.
ALTER TABLE "user" DROP COLUMN is_platform_admin;

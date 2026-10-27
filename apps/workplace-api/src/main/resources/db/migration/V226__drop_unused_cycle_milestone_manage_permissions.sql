-- V226 (WP-1025): 더 이상 아무도 검사하지 않는 권한 코드 cycle:manage·milestone:manage 를 지운다.
--
-- 배경: WP-1008 부터 마일스톤·사이클 변경은 버전처럼 컨트롤러 project:manage + 서비스의 프로젝트 OWNER 검사로 판정한다.
-- 두 코드는 롤링 배포 중 옛 API 파드가 아직 검사해 WP-1008 에서는 남겼다 — WP-1008 이 운영(v0.9.25)에 반영돼 이제 지운다.
-- 지난 마이그레이션(V26·V75·V120·V139)은 고치지 않는다.
--
-- 카탈로그(permission)에서 지우면 role_permission·platform_role_permission 의 부여 행이 ON DELETE CASCADE(V2·V70)로 함께 지워진다.
-- FK 의 참조 동작은 RLS 를 거치지 않으므로 모든 테넌트의 역할에서 빠진다(접속 계정의 BYPASSRLS 여부와 무관).
--
-- 롤백 주의: 이 뒤로 WP-1008 이전 이미지(v0.9.24 이하)로 API 를 되돌리면 그 컨트롤러가 이 코드를 검사해 사이클·마일스톤 변경이
-- 모두 403 이 된다. 그렇게 되돌려야 하면 V26·V120 의 permission INSERT 와 V139 의 USER 부여를 다시 실행해 되살린다.
DELETE FROM permission
WHERE code IN ('cycle:manage', 'milestone:manage');

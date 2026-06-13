-- V46: app_tenant 최소권한 강화 (보안 리뷰 반영).
-- tenant/membership 은 컨트롤 플레인 테이블 — 런타임 롤의 DELETE 를 회수한다.
-- (테넌트/멤버십 삭제는 운영자 평면의 책임이며, 런타임 버그/악용의 폭발 반경을 줄인다.)
-- SELECT/INSERT/UPDATE 는 유지 — 로그인/테넌트선택 조회 및 향후 초대 흐름의 멤버십 생성에 필요.
REVOKE DELETE ON tenant FROM app_tenant;
REVOKE DELETE ON membership FROM app_tenant;

-- Flyway 메타 테이블은 런타임 롤이 접근할 이유가 없다 — 전 권한 회수.
REVOKE ALL PRIVILEGES ON flyway_schema_history FROM app_tenant;

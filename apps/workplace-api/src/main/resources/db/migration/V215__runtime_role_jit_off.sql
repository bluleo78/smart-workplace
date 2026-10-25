-- V215: 런타임 롤 app_tenant 의 JIT 컴파일을 끈다.
--
-- 알림 목록(NotificationRepository.listRecent)이 운영에서 요청마다 약 0.7초 걸렸다. 실제 실행은 30ms 남짓인데,
-- 행마다 붙는 볼 수 있는지 검사(RLS·일정·노트 하위 쿼리) 때문에 플래너의 예상 비용이 jit_inline/optimize 기준(50만)을
-- 넘어, 매 실행마다 LLVM 인라인·최적화 컴파일(약 670ms)이 돌았다. 이 서비스의 쿼리는 짧은 OLTP 라 JIT 이 이득을 내는
-- 경우가 없어 롤 단위로 끈다 — 같은 이유로 비용 추정이 큰 다른 화면 쿼리도 함께 빨라진다.
--
-- 롤 설정은 새 세션부터 적용된다(기존 커넥션 풀은 API 재기동 시 새로 맺는다). Flyway 는 소유자 롤(app)로 실행되므로
-- ALTER ROLE 이 가능하다(V44 참고). 되돌리려면 ALTER ROLE app_tenant RESET jit.
ALTER ROLE app_tenant SET jit = off;

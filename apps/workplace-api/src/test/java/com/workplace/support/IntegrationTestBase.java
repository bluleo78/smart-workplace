package com.workplace.support;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;

import com.workplace.global.tenant.TenantContext;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.transaction.AfterTransaction;
import org.springframework.test.context.transaction.BeforeTransaction;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

  /**
   * 싱글턴 컨테이너의 host:port 를 datasource·flyway URL 양쪽에 주입한다. 자격증명(app_tenant/app)·풀·
   * connection-init-sql·validate-on-migrate 는 application-test.yml 그대로 — URL 만 컨테이너로
   * 갈아끼운다. @ServiceConnection 을 쓰지 않는 이유는 {@link PostgresTestContainer} 참조(RLS 이중 롤).
   */
  @DynamicPropertySource
  static void datasourceProps(DynamicPropertyRegistry registry) {
    var container = PostgresTestContainer.INSTANCE;
    registry.add("spring.datasource.url", container::getJdbcUrl);
    registry.add("spring.flyway.url", container::getJdbcUrl);
  }

  @Autowired protected DSLContext baseDsl;
  @Autowired protected PlatformTransactionManager txManager;

  /**
   * 모든 트랜잭션 통합 테스트의 RLS GUC(app.tenant_id) 를 순서 무관하게 보장한다.
   *
   * <p>배경(#512): GUC 는 {@link com.workplace.global.tenant.TenantAwareTransactionManager#doBegin} 이
   * <b>트랜잭션 시작 시점</b>의 {@link TenantContext} 값으로만 주입한다. 그런데 JUnit5+Spring 에서 테스트 트랜잭션은
   * {@code @BeforeEach} 보다 먼저 시작하므로, 각 테스트가 {@code @BeforeEach} 에서 {@code TenantContext.set(1L)} 해도
   * doBegin 입장에선 이미 늦다. 그 결과 doBegin 은 <i>직전 테스트가 남긴</i> TenantContext 에 의존하게 되어, 앞 테스트가
   * {@code @AfterEach} 에서 clear 했으면 이 테스트의 seed insert 가 GUC 없이 RLS 정책에 걸려 실패한다 — 실행 순서에 따라 대량
   * flaky.
   *
   * <p>{@code @BeforeTransaction} 은 트랜잭션 시작 <b>이전</b>에 실행되므로, 여기서 기본 테넌트(1) 를 심으면 doBegin 이 항상 유효한
   * 테넌트를 보고 GUC 를 주입한다 → 순서 의존 제거. 개별 테스트의 {@code @BeforeEach} TenantContext.set(1L) 은 이제 중복이나
   * 무해하다.
   */
  @BeforeTransaction
  void ensureTenantBeforeTransaction() {
    Long tenantId = defaultTenantId();
    if (tenantId != null) {
      TenantContext.set(tenantId);
    } else {
      // 테넌트 해석 자체를 밑바닥부터 검증하는 테스트(예: JwtAuthenticationFilter 기반 격리 테스트)는
      // null 을 돌려주어 기본 테넌트 주입을 opt-out 한다 — 이 경우 앰비언트 누수만 제거한다.
      TenantContext.clear();
    }
  }

  /**
   * 트랜잭션 시작 전 주입할 기본 테넌트. 기본값 1L(대부분의 RLS 통합 테스트가 테넌트 1 을 사용). 테넌트를 스스로 관리하며 "테넌트 없음(null)" 상태를
   * 단언하는 테스트는 이 메서드를 {@code null} 로 오버라이드해 opt-out 한다.
   */
  protected Long defaultTenantId() {
    return 1L;
  }

  /** 테스트 트랜잭션 종료 후 TenantContext(ThreadLocal) 정리 — 스레드 재사용 시 누수 방지. */
  @AfterTransaction
  void clearTenantAfterTransaction() {
    TenantContext.clear();
  }

  /**
   * 비-{@code @Transactional}(autocommit) 통합 테스트의 세션 GUC(app.tenant_id) 오염을 매 테스트 시작 시 자가치유한다(#512).
   *
   * <p>배경: 일부 비-tx 테스트는 스케줄러/프로덕션 커넥션을 재현하려고 {@code set_config('app.tenant_id', X, false)}(SESSION)
   * 로 풀 커넥션의 세션 GUC 를 바꾼다. 특히 {@code ''}(빈 문자열)을 심고 복원하지 않으면(예: DriveQuotaViewRlsRegressionTest 의
   * fail-closed 재현), 그 커넥션이 풀로 반납되어 <b>다음 비-tx 테스트</b>가 재사용할 때 {@code NULLIF('', '')::bigint =
   * NULL} 이 되어 시드 INSERT 는 RLS {@code WITH CHECK}(tenant_id=NULL → false) 로 거부되고, autocommit 정리
   * DELETE 는 RLS {@code USING} 으로 자기 행을 못 봐 삭제 실패(고아 누적)한다 — 실행 순서에 따라 flaky.
   *
   * <p>여기서 매 테스트 전에 세션 GUC 를 기본값(1) 로 되돌린다. 비-tx 테스트는 autocommit 이라 이 SET 이 즉시 커밋되어 이어지는 시드/정리가 쓸
   * <i>같은 스레드의 커넥션</i>에 적용된다(단일 스레드 실행 → HikariCP thread-local 재할당). {@code @Transactional} 테스트는 이
   * SET 이 테스트 트랜잭션에 묶여 롤백되지만, 그들은 {@code doBegin} 이 트랜잭션-로컬 GUC 를 주입하므로 애초에 세션 GUC 에 의존하지 않는다.
   */
  @BeforeEach
  void resetSessionTenantGuc() {
    baseDsl.execute("SELECT set_config('app.tenant_id', '1', false)");
  }

  /**
   * 비-@Transactional(커밋) 통합 테스트의 RLS-안전 정리 헬퍼. 정리 삭제를 지정 테넌트의 GUC(app.tenant_id)가 주입된 트랜잭션 안에서 실행한다
   * — 트랜잭션 밖 raw 삭제는 풀 커넥션의 잔여 GUC 에 따라 RLS 가 자기 행을 가려 삭제되지 않는(누수) 비결정 버그를 유발하기 때문이다(#512).
   * TenantContext 는 호출 직후 복원(clear)해 ThreadLocal 누수를 막는다.
   */
  protected void cleanupInTenant(long tenantId, Runnable deletes) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      runWithDeadlockRetry(
          () -> new TransactionTemplate(txManager).executeWithoutResult(status -> deletes.run()));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /**
   * 정리 트랜잭션을 데드락 시 재시도한다(#741).
   *
   * <p>배경: Testcontainers 전환 후 테스트가 프로세스 병렬로 돌면서, 서로 다른 테스트의 정리 트랜잭션이 {@code "user"} 행을 엇갈린 순서로 삭제해
   * 데드락이 났다(CalendarEventExternalWriteTest 간헐 실패). FK(event_attendee 등) 참조 검사가 부모/자식 행 잠금을 함께 잡기
   * 때문에 삭제 대상 행이 달라도 순환 대기가 생긴다.
   *
   * <p>정리는 <b>멱등</b>(이미 지워진 행은 0건 삭제)하므로 재시도가 안전하다. 삭제 순서를 전역으로 통일하는 방식은 테스트마다 대상 테이블이 달라 현실적이지 않아,
   * 패배자(victim) 측만 다시 시도하는 쪽을 택했다. 데드락이 아닌 예외는 그대로 던져 실제 결함을 가리지 않는다.
   */
  private void runWithDeadlockRetry(Runnable tx) {
    int attempts = 0;
    while (true) {
      try {
        tx.run();
        return;
      } catch (org.springframework.dao.DeadlockLoserDataAccessException
          | org.springframework.dao.CannotAcquireLockException e) {
        if (++attempts >= 3) throw e;
        try {
          // 짧은 백오프 — 상대 트랜잭션이 끝날 시간을 준다.
          Thread.sleep(50L * attempts);
        } catch (InterruptedException ie) {
          Thread.currentThread().interrupt();
          throw e;
        }
      }
    }
  }

  /**
   * AGENT 유저 시드 (kind='AGENT', password=NULL — 로그인 불가). USER 행 + USER_ROLE("USER") 를 함께 넣어 권한 분기 통합
   * 테스트에서 공통으로 사용한다. 여러 테스트 클래스가 동일 helper 를 쓰도록 base 로 단일화 (Unit 4).
   */
  protected Long createAgentUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, "AGENT")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    return id;
  }
}

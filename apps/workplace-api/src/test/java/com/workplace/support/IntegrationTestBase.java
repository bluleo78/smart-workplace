package com.workplace.support;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;

import com.workplace.global.tenant.TenantContext;
import java.util.UUID;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.transaction.AfterTransaction;
import org.springframework.test.context.transaction.BeforeTransaction;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

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
   * 비-@Transactional(커밋) 통합 테스트의 RLS-안전 정리 헬퍼. 정리 삭제를 지정 테넌트의 GUC(app.tenant_id)가 주입된 트랜잭션 안에서 실행한다
   * — 트랜잭션 밖 raw 삭제는 풀 커넥션의 잔여 GUC 에 따라 RLS 가 자기 행을 가려 삭제되지 않는(누수) 비결정 버그를 유발하기 때문이다(#512).
   * TenantContext 는 호출 직후 복원(clear)해 ThreadLocal 누수를 막는다.
   */
  protected void cleanupInTenant(long tenantId, Runnable deletes) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      new TransactionTemplate(txManager).executeWithoutResult(status -> deletes.run());
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
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

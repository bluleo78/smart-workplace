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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

  @Autowired protected DSLContext baseDsl;
  @Autowired protected PlatformTransactionManager txManager;

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

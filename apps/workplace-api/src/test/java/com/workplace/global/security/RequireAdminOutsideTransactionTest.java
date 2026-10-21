package com.workplace.global.security;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-729 — ADMIN 전용 API 판정({@link PermissionInterceptor})은 요청 트랜잭션이 열리기 전에 돈다. user_role·role 은 테넌트
 * RLS 이고 테넌트 GUC 는 트랜잭션이 시작될 때만 들어가므로, 트랜잭션 없이 읽으면 행이 숨어 실제 서버에서는 관리자도 AI 관리 API 가 403 이었다.
 *
 * <p>테스트 프로파일은 커넥션 세션 GUC 를 tenant#1 로 박아 두어 이 누락을 가린다(NonTransactionalRlsReadGuardTest 참조). 그래서 세션
 * 기본값과 다른 fixture 테넌트에 데이터를 커밋하고, 이 클래스는 트랜잭션 없이 판정을 부른다.
 */
class RequireAdminOutsideTransactionTest extends IntegrationTestBase {

  private static final String FIXTURE_TENANT_SLUG = "require-admin-fixture-tenant";

  @Autowired PermissionChecker permissionChecker;
  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;

  private Long tid2;
  private Long admin;
  private Long roleId;

  @BeforeEach
  void seed() {
    tid2 = ensureFixtureTenant(FIXTURE_TENANT_SLUG);
    admin = TestFixtures.createHuman(dsl);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              setGuc(tid2);
              dsl.insertInto(MEMBERSHIP)
                  .set(MEMBERSHIP.USER_ID, admin)
                  .set(MEMBERSHIP.TENANT_ID, tid2)
                  .set(MEMBERSHIP.STATUS, "ACTIVE")
                  .execute();
              roleId =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "ADMIN")
                      .set(ROLE.IS_SYSTEM, true)
                      .set(ROLE.TENANT_ID, tid2)
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(USER_ROLE)
                  .set(USER_ROLE.USER_ID, admin)
                  .set(USER_ROLE.ROLE_ID, roleId)
                  .set(USER_ROLE.TENANT_ID, tid2)
                  .execute();
            });
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              setGuc(tid2); // 스코프 테이블은 RLS — fixture 테넌트 GUC 에서만 보이고 지워진다.
              dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(admin)).execute();
              dsl.deleteFrom(ROLE).where(ROLE.ID.eq(roleId)).execute();
              dsl.deleteFrom(USER).where(USER.ID.eq(admin)).execute(); // 멤버십은 사용자와 함께 지워진다
            });
  }

  @Test
  void 트랜잭션_밖에서도_지금_워크스페이스의_ADMIN_역할을_읽는다() {
    TenantContext.set(tid2);
    assertThat(permissionChecker.userHasRole(admin, "ADMIN")).isTrue();
  }

  /** 트랜잭션-로컬 GUC 직접 설정. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}

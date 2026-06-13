package com.workplace.notify;

import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V55 notification 도메인 RLS 격리 증명 — 한 테넌트의 notification 행은 다른 테넌트 GUC 컨텍스트에서 비가시이며, 교차 UPDATE/DELETE
 * 도 차단(0행)된다.
 *
 * <p>전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염(app_tenant 는 tenant 행 DELETE 불가 V46; 롤백으로 미커밋 행 모두 사라짐).
 * tenant_id 는 명시 set 하지 않고 컬럼 DEFAULT(현재 GUC)가 채운다 — 따라서 generated jOOQ 에 TENANT_ID 필드가 없어도 컴파일된다.
 */
class NotificationDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  @Test
  void notification_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상(미커밋).
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-noti-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-NOTI")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // recipient FK 대상 user (USER 는 RLS 비대상 — 롤백으로 정리).
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-noti-user-" + suffix)
                      .set(USER.NAME, "RLS-NOTI User")
                      .set(USER.EMAIL, "rls-noti-user-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // GUC 를 tid2 로 전환 후 notification 삽입(tenant_id 는 DEFAULT 가 tid2 로 채움 → WITH CHECK 통과).
              // issue_id 는 nullable(REMINDER 류) — issue FK 없이 REMINDER 타입으로 삽입.
              setGuc(tid2);
              Long nid =
                  dsl.insertInto(NOTIFICATION)
                      .set(NOTIFICATION.RECIPIENT_ID, userId)
                      .set(NOTIFICATION.TYPE, "REMINDER")
                      .returning(NOTIFICATION.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 가시.
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(NOTIFICATION).where(NOTIFICATION.ID.eq(nid))))
                  .isEqualTo(1);

              // GUC 를 tenant#1 로 전환 → tid2 의 notification 은 비가시(RLS USING 차단).
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(dsl.selectFrom(NOTIFICATION).where(NOTIFICATION.ID.eq(nid))))
                  .isZero();

              // tenant#1 컨텍스트에서 tid2 행 UPDATE/DELETE 시도 → USING 차단으로 0행 영향.
              assertThat(
                      dsl.update(NOTIFICATION)
                          .set(NOTIFICATION.TYPE, "HACKED")
                          .where(NOTIFICATION.ID.eq(nid))
                          .execute())
                  .isZero();
              assertThat(dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.ID.eq(nid)).execute())
                  .isZero();

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }
}

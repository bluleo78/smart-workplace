package com.workplace.tenant;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.MESSAGE;
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
 * V50 messaging 도메인 RLS 격리 증명 — 한 테넌트의 channel/message 는 다른 테넌트 GUC 컨텍스트에서 비가시.
 * 전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염 (app_tenant 는 tenant 행 DELETE 불가, V46;
 * 롤백으로 미커밋 tenant/channel/message 행 모두 사라짐).
 */
class MessagingDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /**
   * 트랜잭션-로컬 GUC 를 직접 전환하며, tenant#2 의 channel/message 가 tenant#1 컨텍스트에서 안 보임을 증명.
   * 트랜잭션 내에 신규 테넌트와 channel, message 를 삽입하고 GUC 전환으로 RLS 격리를 확인한 뒤 롤백.
   */
  @Test
  void channelAndMessage_areIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상으로 사용 가능 (미커밋)
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-msg-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-MSG")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // channel.created_by / message.author_id 용 임시 HUMAN user 삽입 (전체 트랜잭션 롤백이므로 오염 없음)
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-msg-user-" + suffix)
                      .set(USER.NAME, "RLS-MSG User")
                      .set(USER.EMAIL, "rls-msg-user-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // GUC 를 tid2 로 전환 후 channel 삽입 (RLS WITH CHECK 통과)
              // kind/visibility 는 DB DEFAULT('CHANNEL'/'PUBLIC') 있으므로 생략 가능, 명시적으로 설정
              setGuc(tid2);
              Long chId =
                  dsl.insertInto(CHANNEL)
                      .set(CHANNEL.KIND, "CHANNEL")
                      .set(CHANNEL.VISIBILITY, "PUBLIC")
                      .set(CHANNEL.CREATED_BY, userId)
                      .set(CHANNEL.TENANT_ID, tid2)
                      .returning(CHANNEL.ID)
                      .fetchOne()
                      .getId();

              // message 삽입 — body 는 nullable 이지만 명시 설정
              Long msgId =
                  dsl.insertInto(MESSAGE)
                      .set(MESSAGE.CHANNEL_ID, chId)
                      .set(MESSAGE.AUTHOR_ID, userId)
                      .set(MESSAGE.BODY, "rls-msg-test")
                      .set(MESSAGE.TENANT_ID, tid2)
                      .returning(MESSAGE.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 가시
              assertThat(dsl.fetchCount(dsl.selectFrom(CHANNEL).where(CHANNEL.ID.eq(chId))))
                  .isEqualTo(1);
              assertThat(dsl.fetchCount(dsl.selectFrom(MESSAGE).where(MESSAGE.ID.eq(msgId))))
                  .isEqualTo(1);

              // GUC 를 tenant#1 로 전환 → tid2 의 channel/message 는 비가시 (RLS USING 차단)
              setGuc(1L);
              assertThat(dsl.fetchCount(dsl.selectFrom(CHANNEL).where(CHANNEL.ID.eq(chId))))
                  .isZero();
              assertThat(dsl.fetchCount(dsl.selectFrom(MESSAGE).where(MESSAGE.ID.eq(msgId))))
                  .isZero();

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}

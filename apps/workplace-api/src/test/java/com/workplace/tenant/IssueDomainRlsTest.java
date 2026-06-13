package com.workplace.tenant;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
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
 * V48 issue 도메인 RLS 격리 증명: 한 테넌트의 project 는 다른 테넌트 GUC 컨텍스트에서 비가시.
 * 전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염
 * (app_tenant 는 tenant 행 DELETE 불가, V46; 롤백으로 미커밋 tenant/project/user 행 모두 사라짐).
 */
class IssueDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /**
   * 트랜잭션-로컬 GUC 를 직접 전환하며, tenant#2 의 project 가 tenant#1 컨텍스트에서 안 보임을 증명.
   * 트랜잭션 내에 신규 테넌트와 user, project 를 삽입하고 GUC 전환으로 RLS 격리를 확인한 뒤 롤백.
   */
  @Test
  void project_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager).execute(status -> {
      // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상으로 사용 가능 (미커밋)
      Long tid2 = dsl.insertInto(TENANT)
          .set(TENANT.SLUG, "rls-iso-" + System.nanoTime())
          .set(TENANT.NAME, "RLS-ISO")
          .set(TENANT.STATUS, "ACTIVE")
          .returning(TENANT.ID)
          .fetchOne().getId();

      // project.owner_id 용 임시 user 삽입 (kind 기본값 HUMAN, 고유 username/email)
      String suffix = String.valueOf(System.nanoTime() % 1_000_000);
      Long ownerId = dsl.insertInto(USER)
          .set(USER.USERNAME, "rls-owner-" + suffix)
          .set(USER.NAME, "RLS Owner")
          .set(USER.EMAIL, "rls-owner-" + suffix + "@example.com")
          .set(USER.KIND, "HUMAN")
          .returning(USER.ID)
          .fetchOne().getId();

      // GUC 를 tid2 로 전환 후 project 삽입 (RLS WITH CHECK 통과)
      setGuc(tid2);
      Long pid = dsl.insertInto(PROJECT)
          .set(PROJECT.KEY, "RLS" + (System.nanoTime() % 100000))
          .set(PROJECT.NAME, "RLS Isolation Test Project")
          .set(PROJECT.OWNER_ID, ownerId)
          .set(PROJECT.TENANT_ID, tid2)
          .returning(PROJECT.ID)
          .fetchOne().getId();

      // tid2 컨텍스트에서는 가시
      assertThat(dsl.fetchCount(dsl.selectFrom(PROJECT).where(PROJECT.ID.eq(pid)))).isEqualTo(1);

      // GUC 를 tenant#1 로 전환 → tid2 의 project 는 비가시 (RLS USING 차단)
      setGuc(1L);
      assertThat(dsl.fetchCount(dsl.selectFrom(PROJECT).where(PROJECT.ID.eq(pid)))).isZero();

      status.setRollbackOnly(); // 공유 DB 무오염
      return null;
    });
  }

  /**
   * issue 본체도 크로스테넌트 격리됨을 증명 — 가장 빈번한 조회 경로의 회귀 가드.
   * project 테스트와 동일한 단일 트랜잭션+롤백 패턴 사용: 공유 DB 무오염.
   * issue.type_id 는 NOT NULL 이므로 tid2 의 issue_type_def 행을 먼저 삽입.
   */
  @Test
  void issue_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager).execute(status -> {
      // 신규 테넌트(tid2) 삽입 — 같은 트랜잭션 내 FK 대상
      Long tid2 =
          dsl.insertInto(TENANT)
              .set(TENANT.SLUG, "rls-iss-" + System.nanoTime())
              .set(TENANT.NAME, "RLS-ISS")
              .set(TENANT.STATUS, "ACTIVE")
              .returning(TENANT.ID)
              .fetchOne()
              .getId();

      // reporter/owner 용 임시 user (kind 기본값 HUMAN, 고유 username/email)
      String suffix = String.valueOf(System.nanoTime() % 1_000_000);
      Long userId =
          dsl.insertInto(USER)
              .set(USER.USERNAME, "rls-iss-user-" + suffix)
              .set(USER.NAME, "RLS-ISS User")
              .set(USER.EMAIL, "rls-iss-user-" + suffix + "@example.com")
              .set(USER.KIND, "HUMAN")
              .returning(USER.ID)
              .fetchOne()
              .getId();

      // GUC 를 tid2 로 전환 후 project 삽입 (RLS WITH CHECK 통과)
      setGuc(tid2);
      Long pid =
          dsl.insertInto(PROJECT)
              .set(PROJECT.KEY, "ISS" + (System.nanoTime() % 100000))
              .set(PROJECT.NAME, "RLS Issue Test Project")
              .set(PROJECT.OWNER_ID, userId)
              .set(PROJECT.TENANT_ID, tid2)
              .returning(PROJECT.ID)
              .fetchOne()
              .getId();

      // issue.type_id 는 NOT NULL → tid2 GUC 컨텍스트에서 issue_type_def 행 삽입
      // tenant_id 는 GUC DEFAULT 로 자동 세팅됨
      Long typeId =
          dsl.insertInto(ISSUE_TYPE_DEF)
              .set(ISSUE_TYPE_DEF.PROJECT_ID, pid)
              .set(ISSUE_TYPE_DEF.NAME, "TASK")
              .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
              .set(ISSUE_TYPE_DEF.ICON, "Circle")
              .returning(ISSUE_TYPE_DEF.ID)
              .fetchOne()
              .getId();

      // issue 삽입 — status/priority 는 DB DEFAULT('TODO'/'MID') 있지만 명시
      // tenant_id 는 GUC DEFAULT 로 자동 세팅됨
      Long iid =
          dsl.insertInto(ISSUE)
              .set(ISSUE.PROJECT_ID, pid)
              .set(ISSUE.NUMBER, 1)
              .set(ISSUE.TITLE, "rls-issue")
              .set(ISSUE.STATUS, "TODO")
              .set(ISSUE.PRIORITY, "MID")
              .set(ISSUE.REPORTER_ID, userId)
              .set(ISSUE.TYPE_ID, typeId)
              .set(ISSUE.TENANT_ID, tid2)
              .returning(ISSUE.ID)
              .fetchOne()
              .getId();

      // tid2 컨텍스트에서는 가시
      assertThat(dsl.fetchCount(dsl.selectFrom(ISSUE).where(ISSUE.ID.eq(iid)))).isEqualTo(1);

      // GUC 를 tenant#1 로 전환 → tid2 의 issue 는 비가시 (RLS USING 차단)
      setGuc(1L);
      assertThat(dsl.fetchCount(dsl.selectFrom(ISSUE).where(ISSUE.ID.eq(iid)))).isZero();

      status.setRollbackOnly(); // 공유 DB 무오염
      return null;
    });
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}

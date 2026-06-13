package com.workplace.audit;

import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.jooq.Table;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V55~V57 audit_log 도메인 RLS 격리 증명.
 *
 * <ul>
 *   <li>① 테넌트 컨텍스트에서 insert 한 행은 다른 테넌트 GUC 컨텍스트에서 비가시(표준 크로스테넌트 격리).
 *   <li>② 인증/시스템 감사의 NULL-테넌트 행은 어떤 실제 테넌트 컨텍스트(1, 2)에서도 비가시 — USING (IS NOT DISTINCT FROM)이
 *       `1`/`2` 와 NULL 을 구분하므로 비노출. 운영자/BYPASSRLS 만 열람(설계 §4).
 * </ul>
 *
 * <p>audit_log 는 수동 DSL.field 로 접근(generated Tables 미사용). 전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염.
 */
class AuditLogDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  private static final Table<?> AUDIT_LOG = table(name("audit_log"));

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(String value) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + value + "', true)");
  }

  /** audit_log 의 특정 id 행이 현재 GUC 컨텍스트에서 보이는 개수. */
  private int countById(Long id) {
    return dsl.fetchCount(
        dsl.selectOne().from(AUDIT_LOG).where(field(name("audit_log", "id")).eq(id)));
  }

  /** 현재 GUC 컨텍스트에서 audit_log insert(RETURNING id). resource/result 는 NOT NULL 이라 명시. */
  private Long insertAudit(String action) {
    return dsl.insertInto(AUDIT_LOG)
        .set(field(name("audit_log", "action_type"), String.class), action)
        .set(field(name("audit_log", "username"), String.class), "rls-tester")
        .set(field(name("audit_log", "resource"), String.class), "auth")
        .set(field(name("audit_log", "result"), String.class), "SUCCESS")
        .returning(field(name("audit_log", "id"), Long.class))
        .fetchOne()
        .get(field(name("audit_log", "id"), Long.class));
  }

  /** ① 테넌트#2 컨텍스트 audit 행이 테넌트#1 컨텍스트에서 비가시 + 교차 UPDATE/DELETE 차단. */
  @Test
  void auditLog_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — DEFAULT 백필 대상 GUC 로 사용.
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-aud-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-AUD")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // GUC=tid2 컨텍스트에서 insert — tenant_id 는 DEFAULT 가 tid2 로 채움.
              setGuc(String.valueOf(tid2));
              Long aid = insertAudit("TENANT_SCOPED");
              assertThat(countById(aid)).isEqualTo(1); // 자기 컨텍스트 가시

              // GUC=1 로 전환 → tid2 행 비가시(USING 차단).
              setGuc("1");
              assertThat(countById(aid)).isZero();

              // GUC=1 에서 tid2 행 UPDATE/DELETE 시도 → 0행 영향.
              assertThat(
                      dsl.update(AUDIT_LOG)
                          .set(field(name("audit_log", "result"), String.class), "HACKED")
                          .where(field(name("audit_log", "id")).eq(aid))
                          .execute())
                  .isZero();
              assertThat(
                      dsl.deleteFrom(AUDIT_LOG)
                          .where(field(name("audit_log", "id")).eq(aid))
                          .execute())
                  .isZero();

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }

  /** ② NULL-테넌트(인증 감사) 행은 GUC='' 에서만 자기 가시, 실제 테넌트(1, 2) 컨텍스트에선 비가시. */
  @Test
  void auditLog_nullTenantRow_invisibleToRealTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — '다른 실제 테넌트' 컨텍스트로 사용.
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-audnull-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-AUDNULL")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // GUC='' (테넌트 미선택, 인증 경로) → tenant_id NULL 로 insert. RETURNING 성공해야 함(V57).
              setGuc("");
              Long nullId = insertAudit("LOGIN");
              assertThat(countById(nullId)).isEqualTo(1); // GUC='' 자기 컨텍스트에선 가시

              // 실제 테넌트#1 컨텍스트 → NULL 행 비가시.
              setGuc("1");
              assertThat(countById(nullId)).isZero();

              // 실제 테넌트#2(tid2) 컨텍스트 → NULL 행 비가시.
              setGuc(String.valueOf(tid2));
              assertThat(countById(nullId)).isZero();

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }
}

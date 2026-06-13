package com.workplace.audit;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.audit.service.AuditLogService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * #216 최우선 회귀 테스트 — 테넌트 컨텍스트가 없는 상태(로그인/가입/로그아웃 인증 감사 경로)에서 audit_log INSERT 가 성공하고 tenant_id 가
 * NULL 로 기록됨을 증명한다.
 *
 * <p><b>왜 이 테스트가 최우선인가:</b> 테스트 하버스는 hikari connection-init-sql 로 세션 GUC {@code app.tenant_id=1} 을
 * 박는다. 그래서 일반 테스트에선 audit INSERT 가 tenant#1 을 상속해 RLS WITH CHECK 를 무조건 통과 — 운영(세션 기본값 없음)에서만 깨지는
 * NULL-테넌트 경로를 가린다. 이 테스트는 세션 GUC 를 명시적으로 비워 진짜 운영 인증 경로를 재현하고, INSERT 가 성공함을 직접 증명한다.
 *
 * <p>설계 함정: audit_log.save 는 {@code INSERT ... RETURNING id} 라서 WITH CHECK 뿐 아니라 USING(SELECT) 정책도
 * 되돌려읽는 행에 적용된다. 표준 {@code tenant_id = <guc>} 는 NULL 행에 대해 {@code NULL = NULL} → NULL(falsy) →
 * RETURNING 단계 거부 → 로그인 실패. 통과하려면 정책이 USING/WITH CHECK 둘 다 {@code IS NOT DISTINCT FROM}(V57) 이어야
 * NULL-vs-NULL 을 TRUE 로 다뤄 NULL 행이 자기 자신에게 보인다.
 */
@Transactional
class AuditLogTenantNullTest extends IntegrationTestBase {

  @Autowired private AuditLogService auditLogService;
  @Autowired private DSLContext dsl;

  @Test
  void auditInsert_succeeds_whenNoTenantContext() {
    // audit_log.user_id 는 FK("user") — 로그인 감사 대상 유저를 먼저 삽입(트랜잭션 롤백으로 정리).
    String suffix = String.valueOf(System.nanoTime() % 1_000_000);
    Long userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "audit-null-" + suffix)
            .set(USER.NAME, "Audit Null")
            .set(USER.EMAIL, "audit-null-" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();

    // 운영의 인증 감사 경로 재현: 세션 GUC 를 빈 문자열로(미선택) 강제(트랜잭션-로컬).
    dsl.execute("SELECT set_config('app.tenant_id', '', true)");
    // 트랜잭션-로컬 TenantContext 도 비움(요청 전/비인증 상태).
    TenantContext.clear();

    Long id =
        auditLogService.log(
            userId,
            "tester",
            "LOGIN",
            "auth",
            null,
            "로그인",
            "127.0.0.1",
            "junit",
            "SUCCESS",
            null,
            null);

    // 핵심 단언: 테넌트 컨텍스트가 없어도 INSERT 가 성공해야 한다(로그인이 깨지지 않음).
    assertThat(id).isNotNull();

    // tenant_id 가 NULL 로 기록됐는지 확인.
    // (V57: USING 이 IS NOT DISTINCT FROM 이라 GUC='' 컨텍스트에서 NULL 행은 자기 자신에게 보인다 →
    //  read-back 이 실제 행을 반환하고 tenant_id 가 NULL 임을 확인. NULL 행이 실제 테넌트(1,2)에
    //  비노출인 강한 증명은 AuditLogDomainRlsTest 가 담당.)
    Integer tid =
        dsl.select(field(name("audit_log", "tenant_id"), Integer.class))
            .from(table(name("audit_log")))
            .where(field(name("audit_log", "id")).eq(id))
            .fetchOne(0, Integer.class);
    assertThat(tid).isNull();
  }
}

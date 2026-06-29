package com.workplace.mail.service;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Task 5·6: 선제 요약 스케줄러 per-tenant 순회 RLS 격리 검증.
 *
 * <p>{@code runOnce()} 의 ① 수집 단계가 {@link
 * com.workplace.global.tenant.TenantScopedRunner#forEachActiveTenant} 로 테넌트별 GUC 를 주입하므로, T1 객관적
 * 패스가 자기 테넌트의 계정만 본다(상대 테넌트 PHANTOM 격리)는 것을 단언한다.
 *
 * <p>두 테넌트(1, tid2)에 각각 AI ON 계정과 공통 비서를 시드하고 {@code runOnce()} 1회 → backfill spy 가 (userA,
 * accountA) 와 (userB, accountB) 를 각각 정확히 1회 받았는지 검증한다. 만약 테넌트 A 수집이 상대 테넌트 계정을 누수했다면 backfill
 * 이 같은 (userB, accountB) 를 2회 받아 {@code times(1)} 이 깨진다(격리 위반 적발).
 *
 * <p>backfill 은 mock — 실제 IMAP/LLM I/O 를 차단하고 호출 인자(userId, accountId)만 수집한다.
 *
 * <p>공유 test DB 에는 다른 테스트가 만든 ACTIVE 테넌트가 누적될 수 있어({@code app_tenant} 는 tenant DELETE 불가, V46)
 * {@code findActiveTenantIds()} 가 2개 초과를 돌 수 있다. 그래서 전수 {@code verifyNoMoreInteractions} 대신 시드한 두
 * 계정에 대한 {@code times(1)} 만 단언한다 — 누수는 중복 호출로 잡히고, 무관 테넌트 호출은 다른 인자라 무시된다.
 */
@DisplayName("선제 요약 스케줄러 per-tenant 순회 → 테넌트별 AI 계정 격리")
class MailSummarySchedulerIT extends IntegrationTestBase {

  private static final String TENANT2_SLUG = "mail-summary-sched-tenant-2";

  @Autowired DSLContext dsl;
  @Autowired MailSummaryScheduler scheduler;

  /** 실제 IMAP/LLM 차단 — 호출 인자만 spy(아래 doAnswer)로 수집. */
  @MockitoBean MailSummaryBackfillService backfill;

  /** backfill 이 받은 (userId, accountId, 호출시점 TenantContext) 기록 — 디스패치 컨텍스트까지 검증. */
  private record Call(long userId, long accountId, Long ctx) {}

  private final List<Call> calls = new ArrayList<>();

  private Long account1;
  private Long account2;
  private Long user1;
  private Long user2;
  private long tid2;

  /** 공통 비서 에이전트 ID (워크스페이스별 정리용). */
  private Long wsAgent1;

  private Long wsAgent2;

  /** 세션 GUC 를 대상 테넌트로 전환(autocommit 시드/조회용). */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  /** 고정 슬러그로 두 번째 ACTIVE 테넌트를 find-or-create(누적 방지, app_tenant 는 tenant DELETE 불가). */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(TENANT2_SLUG)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TENANT2_SLUG)
        .set(TENANT.NAME, "Mail Summary Sched Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 세션 GUC 컨텍스트에 HUMAN user 1명 생성. */
  private long seedUser() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "msched_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U" + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 세션 GUC 컨텍스트에 AGENT user 1명 생성. */
  private long seedAgentUser() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "agent_" + t)
        .set(USER.NAME, "Agent_" + t)
        .set(USER.EMAIL, "agent_" + t + "@example.com")
        .set(USER.KIND, "AGENT")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 세션 GUC 컨텍스트에 AI ON 계정 1건 시드. accountId 반환. */
  private long seedAiAccount(long userId, String addr) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, addr)
        .set(EMAIL_ACCOUNT.IMAP_HOST, "imap.x")
        .set(EMAIL_ACCOUNT.IMAP_PORT, 993)
        .set(EMAIL_ACCOUNT.IMAP_SECURITY, "SSL_TLS")
        .set(EMAIL_ACCOUNT.IMAP_USERNAME, addr)
        .set(EMAIL_ACCOUNT.SMTP_HOST, "smtp.x")
        .set(EMAIL_ACCOUNT.SMTP_PORT, 465)
        .set(EMAIL_ACCOUNT.SMTP_SECURITY, "SSL_TLS")
        .set(EMAIL_ACCOUNT.SMTP_USERNAME, addr)
        .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, "enc")
        .set(EMAIL_ACCOUNT.AI_ENABLED, true) // 선제 요약 대상
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 현재 세션 GUC 테넌트에 공통 비서를 직접 시드한다. credentialService.register() 를 피해 audit_log 의존 없이 최소 행만 삽입.
   *
   * <p>resolveWorkspaceOrEmpty() 는 workspace_assistant.agent_user_id + ai_agent_credential.revoked_at
   * IS NULL 을 확인한다.
   *
   * @param adminId created_by 참조용 사용자 ID
   * @return 생성된 AGENT user ID (정리 대상 추적용)
   */
  private long seedWorkspaceAssistant(long adminId) {
    long agentId = seedAgentUser();
    // ai_agent_credential: tenant_id 없음(전역) — revoked_at IS NULL 이면 active.
    dsl.insertInto(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.USER_ID, agentId)
        .set(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN, "enc-test-token")
        .set(AI_AGENT_CREDENTIAL.LABEL, "sched-it-test")
        .set(AI_AGENT_CREDENTIAL.CREATED_BY, adminId)
        .execute();
    // workspace_assistant: tenant_id = 현재 세션 GUC(ON CONFLICT (tenant_id) DO UPDATE).
    dsl.execute(
        "INSERT INTO workspace_assistant (agent_user_id, updated_by, updated_at)"
            + " VALUES (?, ?, now())"
            + " ON CONFLICT (tenant_id) DO UPDATE SET"
            + " agent_user_id = excluded.agent_user_id,"
            + " updated_by = excluded.updated_by,"
            + " updated_at = now()",
        agentId,
        adminId);
    return agentId;
  }

  @AfterEach
  void cleanup() {
    // 공통 비서 정리 — tenant_id 기반 RLS 가 적용되므로 cleanupInTenant 로 tx-local GUC 주입.
    if (wsAgent1 != null) {
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(WORKSPACE_ASSISTANT).execute(); // RLS 로 tenant#1 행만 삭제
            dsl.deleteFrom(AI_AGENT_CREDENTIAL)
                .where(AI_AGENT_CREDENTIAL.USER_ID.eq(wsAgent1))
                .execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(wsAgent1)).execute();
          });
    }
    if (wsAgent2 != null) {
      cleanupInTenant(
          tid2,
          () -> {
            dsl.deleteFrom(WORKSPACE_ASSISTANT).execute();
            dsl.deleteFrom(AI_AGENT_CREDENTIAL)
                .where(AI_AGENT_CREDENTIAL.USER_ID.eq(wsAgent2))
                .execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(wsAgent2)).execute();
          });
    }
    // 메일 계정 + 사용자 정리
    if (account1 != null) {
      setSessionGuc(1L);
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(account1)).execute();
      if (user1 != null) dsl.deleteFrom(USER).where(USER.ID.eq(user1)).execute();
    }
    if (account2 != null) {
      setSessionGuc(tid2);
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(account2)).execute();
      if (user2 != null) dsl.deleteFrom(USER).where(USER.ID.eq(user2)).execute();
    }
    setSessionGuc(1L);
    TenantContext.clear();
  }

  @Test
  @DisplayName("두 테넌트 AI 계정 + 공통비서 → runOnce() 1회 → 각 계정 자기 테넌트 컨텍스트에서만 T1 요약")
  void runOnce_테넌트별_AI계정만_자기메일_요약() {
    tid2 = ensureSecondTenant();

    // T1 패스만 기록 — 두 패스 모두 같은 루프 내 동일 TenantContext 에서 호출되므로 T1 으로 컨텍스트 검증 가능.
    Mockito.doAnswer(
            inv -> {
              calls.add(new Call(inv.getArgument(0), inv.getArgument(1), TenantContext.get()));
              return null;
            })
        .when(backfill)
        .summarizeObjectiveRecentNow(
            org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong());

    String run = UUID.randomUUID().toString().substring(0, 8);

    // tenant#1: AI 계정 + 공통 비서 시드 (T1 패스 활성화).
    setSessionGuc(1L);
    user1 = seedUser();
    account1 = seedAiAccount(user1, "u1-" + run + "@x.com");
    wsAgent1 = seedWorkspaceAssistant(user1); // T1: resolveWorkspaceOrEmpty() 가 이 비서 반환

    // tenant#2: AI 계정 + 공통 비서 시드.
    setSessionGuc(tid2);
    user2 = seedUser();
    account2 = seedAiAccount(user2, "u2-" + run + "@x.com");
    wsAgent2 = seedWorkspaceAssistant(user2);

    // 세션 GUC 를 기본값(1)으로 복원 — 스케줄러는 TenantContext 를 자체 주입하므로 호출 전 세션 상태와 무관.
    setSessionGuc(1L);

    // ① 수집(forEachActiveTenant per-tenant GUC) → ② backfill 디스패치.
    scheduler.runOnce();

    final long fU1 = user1;
    final long fA1 = account1;
    final long fU2 = user2;
    final long fA2 = account2;
    // 각 계정 T1 패스가 정확히 1회만 — 누수면 (userB, accountB) 가 2회 잡혀 깨진다.
    verify(backfill, times(1)).summarizeObjectiveRecentNow(fU1, fA1);
    verify(backfill, times(1)).summarizeObjectiveRecentNow(fU2, fA2);

    // 디스패치 컨텍스트 검증 — A 는 tenant 1, B 는 tid2 컨텍스트에서 요약(stage② TenantContext 주입 증명).
    Long ctxA =
        calls.stream().filter(c -> c.accountId() == fA1).map(Call::ctx).findFirst().orElse(null);
    Long ctxB =
        calls.stream().filter(c -> c.accountId() == fA2).map(Call::ctx).findFirst().orElse(null);
    assertThat(ctxA).isEqualTo(1L);
    assertThat(ctxB).isEqualTo(tid2);
  }
}

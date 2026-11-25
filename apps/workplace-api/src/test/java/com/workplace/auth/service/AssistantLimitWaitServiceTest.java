package com.workplace.auth.service;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.workplace.auth.outbound.AiLimitWaitNoticeEvent;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-2108: 비서 자격별 사용 한도 대기 서비스. mark 가 호출자 트랜잭션과 떨어진 새 트랜잭션에서 쓰므로 픽스처는 커밋되어야 한다 — 비-@Transactional
 * 테스트이며 끝에 직접 정리한다. 이벤트는 AFTER_COMMIT 리스너(Task 3 와 같은 시점)로 모아 스레드와 무관하게 센다.
 */
@Import(AssistantLimitWaitServiceTest.Collector.class)
class AssistantLimitWaitServiceTest extends IntegrationTestBase {

  /** 발행된 알림 이벤트를 커밋 뒤에 모은다. */
  @TestConfiguration
  static class Collector {
    static final List<AiLimitWaitNoticeEvent> EVENTS = new CopyOnWriteArrayList<>();

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(AiLimitWaitNoticeEvent e) {
      EVENTS.add(e);
    }
  }

  @Autowired AssistantLimitWaitService service;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired WorkspaceAssistantRepository workspaceRepo;
  @Autowired UserRepository userRepository;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> credentials = new ArrayList<>();
  private final List<Long> tenants = new ArrayList<>();

  @BeforeEach
  void setUp() {
    Collector.EVENTS.clear();
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
    List<Long> tenantIds = new ArrayList<>(tenants);
    tenantIds.add(1L);
    for (long t : tenantIds) {
      cleanupInTenant(
          t,
          () -> {
            baseDsl
                .deleteFrom(ASSISTANT_LIMIT_WAIT)
                .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.in(credentials))
                .execute();
            // 알림 이벤트가 인박스 알림(notification)을 만든다 — 수신자·행위자 FK 라 사용자 삭제 전에 지운다.
            baseDsl
                .deleteFrom(NOTIFICATION)
                .where(NOTIFICATION.RECIPIENT_ID.in(users).or(NOTIFICATION.ACTOR_ID.in(users)))
                .execute();
            baseDsl
                .deleteFrom(WORKSPACE_ASSISTANT)
                .where(WORKSPACE_ASSISTANT.AGENT_USER_ID.in(users))
                .execute();
          });
    }
    deleteUsersRetrying(
        () -> {
          baseDsl
              .update(USER)
              .setNull(USER.PERSONAL_ASSISTANT_AGENT_ID)
              .where(USER.PERSONAL_ASSISTANT_AGENT_ID.in(users))
              .execute();
          // 인박스 알림은 커밋 뒤 비동기로 늦게 들어올 수 있어 사용자 삭제와 같은 트랜잭션에서 한 번 더 지운다.
          baseDsl
              .deleteFrom(NOTIFICATION)
              .where(NOTIFICATION.RECIPIENT_ID.in(users).or(NOTIFICATION.ACTOR_ID.in(users)))
              .execute();
          baseDsl
              .deleteFrom(AI_AGENT_CREDENTIAL)
              .where(AI_AGENT_CREDENTIAL.ID.in(credentials))
              .execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
  }

  /** 알림 비동기 스레드가 지우는 사이에 알림을 넣을 수 있어, FK 위반이면 잠시 뒤 다시 지운다(최대 약 3초). */
  private void deleteUsersRetrying(Runnable deletes) {
    for (int attempt = 1; ; attempt++) {
      try {
        cleanupInTenant(1L, deletes);
        return;
      } catch (org.springframework.dao.DataIntegrityViolationException e) {
        if (attempt >= 30) throw e;
        try {
          Thread.sleep(100);
        } catch (InterruptedException ie) {
          Thread.currentThread().interrupt();
          throw e;
        }
      }
    }
  }

  private long human() {
    long id = TestFixtures.createHuman(baseDsl);
    users.add(id);
    return id;
  }

  private long agent() {
    long id = TestFixtures.createAgentNoToken(baseDsl);
    users.add(id);
    return id;
  }

  private long credential(long agentId, long creator) {
    // 활성 자격은 에이전트당 1개 — 새 에이전트마다 하나씩 만든다.
    long id = credentialRepo.insert(agentId, "anthropic", "iv:ct", "t", creator);
    credentials.add(id);
    return id;
  }

  /** 개인 비서(주인 owner) 하나와 그 자격. */
  private long[] personal() {
    long owner = human();
    long agent = agent();
    personalRepo.setAgentId(owner, agent);
    return new long[] {owner, agent, credential(agent, owner)};
  }

  private static void assertNear(Instant actual, Instant expected) {
    assertThat(actual).isCloseTo(expected, within(1, ChronoUnit.SECONDS));
  }

  @Test
  void 개인비서_처음_걸리면_주인에게_한번_알림() {
    long[] p = personal();
    Instant want = Instant.now().plus(Duration.ofHours(2));

    Instant got = service.mark(p[2], p[1], want);

    assertNear(got, want);
    assertThat(Collector.EVENTS).hasSize(1);
    AiLimitWaitNoticeEvent e = Collector.EVENTS.get(0);
    assertThat(e.recipientIds()).containsExactly(p[0]);
    assertThat(e.scope()).isEqualTo("PERSONAL_ASSISTANT");
    assertThat(e.actorId()).isEqualTo(p[1]);
    assertThat(e.tenantId()).isEqualTo(1L);
    assertThat(e.message()).startsWith("AI 비서가 사용 한도에 걸려 ");
  }

  @Test
  void 공통비서는_관리자들에게() {
    long admin = human();
    TestFixtures.ensureActiveMember(baseDsl, admin, 1L);
    callInTenant(
        1L,
        () -> {
          TestFixtures.grantRole(baseDsl, admin, "ADMIN");
          return null;
        });
    long agent = agent();
    long cred = credential(agent, admin);
    callInTenant(
        1L,
        () -> {
          workspaceRepo.upsert(agent, admin);
          return null;
        });

    service.mark(cred, agent, Instant.now().plus(Duration.ofHours(2)));

    assertThat(Collector.EVENTS).hasSize(1);
    AiLimitWaitNoticeEvent e = Collector.EVENTS.get(0);
    assertThat(e.recipientIds())
        .containsExactlyInAnyOrderElementsOf(userRepository.findWorkspaceActiveAdminIds(1L));
    assertThat(e.recipientIds()).contains(admin);
    assertThat(e.scope()).isEqualTo("WORKSPACE_ASSISTANT");
    assertThat(e.message()).startsWith("공통 AI 비서가 사용 한도에 걸려 ");
  }

  @Test
  void 대기중_다시_걸리면_늦은쪽으로_늘리고_알림없음() {
    long[] p = personal();
    Instant now = Instant.now();
    service.mark(p[2], p[1], now.plus(Duration.ofHours(1)));
    Instant later = now.plus(Duration.ofHours(3));

    assertNear(service.mark(p[2], p[1], later), later);
    assertThat(Collector.EVENTS).hasSize(1);

    assertNear(service.mark(p[2], p[1], now.plus(Duration.ofMinutes(30))), later);
    assertThat(Collector.EVENTS).hasSize(1);
  }

  @Test
  void 만료뒤_다시걸리면_새로_알림() {
    long[] p = personal();
    service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(1)));
    cleanupInTenant(
        1L,
        () ->
            baseDsl
                .update(ASSISTANT_LIMIT_WAIT)
                .set(ASSISTANT_LIMIT_WAIT.UNTIL_AT, java.time.OffsetDateTime.now().minusMinutes(1))
                .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(p[2]))
                .execute());

    service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));

    assertThat(Collector.EVENTS).hasSize(2);
  }

  /** WP-2108 최종 검토 4: 풀리는 시각을 모르는(기본 +1h) 한도가 만료 직후 또 걸리면 같은 한도의 연장이라 다시 알리지 않고 더 오래 쉰다. */
  @Test
  void 풀리는_시각을_모르는_한도가_만료_직후_또_걸리면_알리지_않고_더_오래_쉰다() {
    long[] p = personal();
    service.mark(p[2], p[1], null);
    cleanupInTenant(
        1L,
        () ->
            baseDsl
                .update(ASSISTANT_LIMIT_WAIT)
                .set(ASSISTANT_LIMIT_WAIT.UNTIL_AT, java.time.OffsetDateTime.now().minusMinutes(1))
                .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(p[2]))
                .execute());

    Instant second = service.mark(p[2], p[1], null);

    assertThat(Collector.EVENTS).hasSize(1);
    assertThat(second).isAfter(Instant.now().plus(Duration.ofHours(3)));
  }

  /** 풀리는 시각을 아는 한도는 예전 그대로 — 만료 뒤 다시 걸리면 새 대기로 알린다(같은 시험에서 모르는 쪽과 구분). */
  @Test
  void 풀리는_시각을_아는_한도는_만료_직후에도_새로_알린다() {
    long[] p = personal();
    service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(1)));
    cleanupInTenant(
        1L,
        () ->
            baseDsl
                .update(ASSISTANT_LIMIT_WAIT)
                .set(ASSISTANT_LIMIT_WAIT.UNTIL_AT, java.time.OffsetDateTime.now().minusMinutes(1))
                .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(p[2]))
                .execute());

    Instant second = service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(5)));

    assertThat(Collector.EVENTS).hasSize(2);
    assertNear(second, Instant.now().plus(Duration.ofHours(5)));
  }

  /** WP-2108 최종 검토 9: 개인 비서이면서 공통 비서로도 지정된 AGENT 는 주인과 관리자 모두에게 알린다. */
  @Test
  void 개인이면서_공통_비서인_에이전트는_주인과_관리자_모두에게_알린다() {
    long[] p = personal();
    long admin = human();
    TestFixtures.ensureActiveMember(baseDsl, admin, 1L);
    callInTenant(
        1L,
        () -> {
          TestFixtures.grantRole(baseDsl, admin, "ADMIN");
          workspaceRepo.upsert(p[1], admin);
          return null;
        });

    service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));

    assertThat(Collector.EVENTS)
        .extracting(AiLimitWaitNoticeEvent::scope)
        .containsExactlyInAnyOrder("PERSONAL_ASSISTANT", "WORKSPACE_ASSISTANT");
    AiLimitWaitNoticeEvent ws =
        Collector.EVENTS.stream()
            .filter(e -> e.scope().equals("WORKSPACE_ASSISTANT"))
            .findFirst()
            .orElseThrow();
    assertThat(ws.recipientIds()).contains(admin);
  }

  @Test
  void 동시에_두번_mark_해도_알림은_한번() throws Exception {
    long[] p = personal();
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch go = new CountDownLatch(1);
    try {
      List<Future<Instant>> fs = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        fs.add(
            pool.submit(
                () -> {
                  TenantContext.set(1L);
                  try {
                    go.await();
                    return service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));
                  } finally {
                    TenantContext.clear();
                  }
                }));
      }
      go.countDown();
      for (Future<Instant> f : fs) f.get();
    } finally {
      pool.shutdownNow();
    }

    assertThat(Collector.EVENTS).hasSize(1);
  }

  @Test
  void 한_바깥_트랜잭션_안의_두_mark_도_알림은_한번() {
    long[] p = personal();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));
              service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));
            });

    assertThat(Collector.EVENTS).hasSize(1);
  }

  @Test
  void 바깥_트랜잭션이_롤백돼도_대기는_남는다() {
    long[] p = personal();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));
              s.setRollbackOnly();
            });

    assertThat(service.activeUntil(p[2])).isPresent();
    assertThat(Collector.EVENTS).hasSize(1);
  }

  @Test
  void 다른_테넌트의_같은_자격은_따로_대기() {
    long[] p = personal();
    long tenantB = TestFixtures.createTenant(baseDsl, "ACTIVE");
    tenants.add(tenantB);

    service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));
    TenantContext.set(tenantB);
    assertThat(service.activeUntil(p[2])).isEmpty();
    service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(2)));

    assertThat(service.activeUntil(p[2])).isPresent();
    TenantContext.set(1L);
    assertThat(service.activeUntil(p[2])).isPresent();
    // 두 테넌트 모두 새 대기로 시작해 알림이 각각 한 번.
    assertThat(Collector.EVENTS)
        .extracting(AiLimitWaitNoticeEvent::tenantId)
        .containsExactlyInAnyOrder(1L, tenantB);
  }

  @Test
  void 지난시각이나_8일넘는_미래면_지금_더하기_1시간() {
    Instant expect = Instant.now().plus(Duration.ofHours(1));
    Instant[] inputs = {
      Instant.now().minus(Duration.ofMinutes(5)), null, Instant.now().plus(Duration.ofDays(9))
    };
    for (Instant in : inputs) {
      long[] p = personal();
      Instant got = service.mark(p[2], p[1], in);
      assertThat(got).isCloseTo(expect, within(5, ChronoUnit.SECONDS));
    }
  }

  @Test
  void activeUntil_은_지난대기를_돌려주지_않는다() {
    long[] p = personal();
    service.mark(p[2], p[1], Instant.now().plus(Duration.ofHours(1)));
    cleanupInTenant(
        1L,
        () ->
            baseDsl
                .update(ASSISTANT_LIMIT_WAIT)
                .set(ASSISTANT_LIMIT_WAIT.UNTIL_AT, java.time.OffsetDateTime.now().minusMinutes(1))
                .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(p[2]))
                .execute());

    assertThat(service.activeUntil(p[2])).isEmpty();
  }

  @Test
  void 문구_형식() {
    Instant now = Instant.parse("2026-11-25T01:00:00Z");
    assertThat(AssistantLimitWaitService.formatUntil(Instant.parse("2026-11-25T06:30:00Z"), now))
        .isEqualTo("15:30");
    assertThat(AssistantLimitWaitService.formatUntil(Instant.parse("2026-11-26T06:30:00Z"), now))
        .isEqualTo("11월 26일 15:30");
    assertThat(AssistantLimitWaitService.waitingMessage(Instant.parse("2026-11-25T06:30:00Z"), now))
        .isEqualTo("사용 한도에 걸렸어요(15:30 이후 다시 시도해 주세요)");
    assertThat(AssistantLimitWaitService.personalNotice(Instant.parse("2026-11-25T06:30:00Z"), now))
        .isEqualTo("AI 비서가 사용 한도에 걸려 15:30까지 쉽니다 — 다른 모델로 바꾸거나 기다려 주세요");
    assertThat(
            AssistantLimitWaitService.workspaceNotice(Instant.parse("2026-11-25T06:30:00Z"), now))
        .isEqualTo("공통 AI 비서가 사용 한도에 걸려 15:30까지 AI 처리를 쉽니다");
  }
}

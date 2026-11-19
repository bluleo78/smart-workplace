package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.QueuedSend;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.service.MailQueuedSender;
import com.workplace.mail.service.MailSendQueueScheduler;
import com.workplace.mail.service.MailSendQueueService;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 보낼 대기열 스케줄러(WP-1786) 통합 — 시각이 된 대기 행만 보내고(성공하면 임시보관 삭제·SENT 행), 실패하면 FAILED·알림, 10분 넘게 SENDING 에
 * 멈춘 행은 다시 보내지 않고 「확인하지 못함」 알림, 두 스레드가 겹쳐도 한 번만 보내고, 테넌트마다 각자 보낸다.
 *
 * <p>테스트 프로필은 스케줄링·분산 잠금이 꺼져 있어(application-test.yml workplace.scheduling.*) 실제 5초 폴러가 끼어들지 않는다 —
 * 테스트가 {@link MailSendQueueScheduler#poll()} 을 직접 부른다. 잠금이 꺼져 있으니 동시 호출 테스트는 ShedLock 없이 SKIP
 * LOCKED·상태 조건만으로 한 번 발송이 지켜지는지 본다. 전송은 Graph 계정 + 목 {@link GraphApiClient}(성공 = 아무것도 안 함, 실패 =
 * 예외)로 대신한다. 발송·알림이 각자 트랜잭션으로 커밋돼야 해 테스트 트랜잭션 없이 돌고, 시드는 {@link #cleanup} 에서 지운다.
 */
class MailSendQueueSchedulerIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailSendQueueScheduler scheduler;
  @Autowired MailQueuedSender sender;
  @Autowired MailSendQueueService queueService;
  @Autowired MailDraftRepository draftRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired NotificationService notificationService;
  @Autowired EncryptionService encryption;
  @Autowired GraphApiClient graphApiClient;

  /** 테넌트별로 만든 사용자 — 정리할 때 그 테넌트 GUC 로 지운다. */
  private final Map<Long, List<Long>> usersByTenant = new HashMap<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  /** 알림 → file(uploaded_by) → 계정(메일·임시저장 CASCADE) → 사용자 순으로, 테넌트마다 그 GUC 로 정리. */
  @AfterEach
  void cleanup() {
    for (Map.Entry<Long, List<Long>> e : usersByTenant.entrySet()) {
      List<Long> users = e.getValue();
      cleanupInTenant(
          e.getKey(),
          () -> {
            dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.RECIPIENT_ID.in(users)).execute();
            dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(users)).execute();
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.USER_ID.in(users)).execute();
          });
      cleanupInTenant(1L, () -> dsl.deleteFrom(USER).where(USER.ID.in(users)).execute());
    }
    usersByTenant.clear();
    TenantContext.clear();
  }

  /** 테넌트의 활성 구성원 한 명. */
  private long user(long tenantId) {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, id, tenantId);
    usersByTenant.computeIfAbsent(tenantId, k -> new ArrayList<>()).add(id);
    return id;
  }

  /** 테넌트에 Graph 계정을 만든다(전송은 목 GraphApiClient). */
  private long account(long tenantId, long user) {
    return callInTenant(tenantId, () -> MailTestSupport.seedGraphAccount(dsl, encryption, user));
  }

  private MailSendRequest req(String subject) {
    return new MailSendRequest(
        List.of("peer@example.com"),
        List.of(),
        List.of(),
        subject,
        "<p>본문</p>",
        "본문",
        null,
        null,
        null,
        null,
        null);
  }

  /** 대기열에 올리고 보낼 시각을 이미 지난 것으로 당긴다(10초를 기다리지 않게). */
  private long queuedDue(long tenantId, long user, long acc, String subject) {
    return callInTenant(
        tenantId,
        () -> {
          QueuedSend q = queueService.enqueue(user, acc, req(subject));
          dsl.update(MAIL_DRAFT)
              .set(MAIL_DRAFT.SEND_AT, DSL.currentOffsetDateTime().minus(1))
              .where(MAIL_DRAFT.ID.eq(q.draftId()))
              .execute();
          return q.draftId();
        });
  }

  private boolean draftExists(long tenantId, long draftId) {
    return callInTenant(tenantId, () -> dsl.fetchExists(MAIL_DRAFT, MAIL_DRAFT.ID.eq(draftId)));
  }

  private String state(long tenantId, long draftId) {
    return callInTenant(
        tenantId,
        () ->
            dsl.select(MAIL_DRAFT.SEND_STATE)
                .from(MAIL_DRAFT)
                .where(MAIL_DRAFT.ID.eq(draftId))
                .fetchOne(MAIL_DRAFT.SEND_STATE));
  }

  private List<String> sentSubjects(long tenantId, long acc) {
    return callInTenant(
        tenantId,
        () ->
            messageRepo.listByAccount(acc, "SENT", null, 50).stream()
                .map(EmailMessageSummary::subject)
                .toList());
  }

  private List<NotificationResponse> notices(long tenantId, long user) {
    return callInTenant(tenantId, () -> notificationService.listRecent(user, 10, 0));
  }

  @Test
  void 시각이_된_QUEUED_는_보내지고_임시보관이_지워지며_SENT_행이_생긴다() {
    long me = user(1L);
    long acc = account(1L, me);
    long draftId = queuedDue(1L, me, acc, "보낼 메일");

    scheduler.poll();

    verify(graphApiClient, times(1)).sendMail(any(), any());
    assertThat(draftExists(1L, draftId)).isFalse();
    assertThat(sentSubjects(1L, acc)).containsExactly("보낼 메일");
    assertThat(notices(1L, me)).isEmpty();
  }

  @Test
  void 시각이_안_된_QUEUED_는_그대로() {
    long me = user(1L);
    long acc = account(1L, me);
    QueuedSend q = callInTenant(1L, () -> queueService.enqueue(me, acc, req("아직")));

    scheduler.poll();

    verify(graphApiClient, never()).sendMail(any(), any());
    assertThat(state(1L, q.draftId())).isEqualTo("QUEUED");
    assertThat(sentSubjects(1L, acc)).isEmpty();
  }

  @Test
  void 전송이_실패하면_FAILED_이고_send_at_NULL_이며_MAIL_SEND_FAILED_알림이_간다() {
    long me = user(1L);
    long acc = account(1L, me);
    long draftId = queuedDue(1L, me, acc, "실패할 메일");
    // 공급자 내부 문구(응답 코드)는 사유로 남지 않고 기본 문구로 바뀐다(최종 리뷰 T4-M2 — 화면에 내부 정보가 새지 않게)
    doThrow(new MailSendException("Graph post 실패: 500"))
        .when(graphApiClient)
        .sendMail(any(), any());

    scheduler.poll();

    var row =
        callInTenant(
            1L, () -> dsl.selectFrom(MAIL_DRAFT).where(MAIL_DRAFT.ID.eq(draftId)).fetchOne());
    assertThat(row).isNotNull();
    assertThat(row.getSendState()).isEqualTo("FAILED");
    assertThat(row.getSendAt()).isNull();
    assertThat(row.getSendError()).isEqualTo("메일을 보내지 못했어요. 잠시 뒤 다시 보내 주세요");
    assertThat(sentSubjects(1L, acc)).isEmpty();
    assertThat(notices(1L, me))
        .singleElement()
        .satisfies(
            n -> {
              assertThat(n.type()).isEqualTo("MAIL_SEND_FAILED");
              assertThat(n.message()).isEqualTo("실패할 메일");
              assertThat(n.mailDraftId()).isEqualTo(draftId);
              assertThat(n.mailSendUnknown()).isFalse();
            });

    // 자동으로 다시 보내지 않는다 — 다음 회차는 FAILED 행을 건드리지 않는다
    scheduler.poll();
    verify(graphApiClient, times(1)).sendMail(any(), any());
    assertThat(notices(1L, me)).hasSize(1);
  }

  @Test
  void poll_을_두_스레드가_동시에_돌려도_전송은_한_번() throws Exception {
    long me = user(1L);
    long acc = account(1L, me);
    List<Long> drafts = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      drafts.add(queuedDue(1L, me, acc, "동시 " + i));
    }

    // ① 잡기 경합 — 두 스레드가 같은 순간 claimDue 를 해도 같은 행을 두 번 잡지 않는다(FOR UPDATE SKIP LOCKED + 상태 전환)
    List<List<Long>> claimed =
        runTogether(
            () -> callInTenant(1L, () -> draftRepo.claimDue(20)),
            () -> callInTenant(1L, () -> draftRepo.claimDue(20)));
    Set<Long> union = new HashSet<>();
    int total = 0;
    for (List<Long> c : claimed) {
      union.addAll(c);
      total += c.size();
    }
    assertThat(union).containsAll(drafts);
    assertThat(total).isEqualTo(union.size());

    // 잡힌 행을 다시 대기로 돌려 poll 경합을 본다
    callInTenant(
        1L,
        () ->
            dsl.update(MAIL_DRAFT)
                .set(MAIL_DRAFT.SEND_STATE, "QUEUED")
                .set(MAIL_DRAFT.SENDING_STARTED_AT, (java.time.OffsetDateTime) null)
                .where(MAIL_DRAFT.ID.in(drafts))
                .execute());

    // ② poll 경합 — 잠금이 꺼진 상태에서 두 스레드가 동시에 돌아도 각 메일은 한 번만 나간다
    runTogether(
        () -> {
          scheduler.poll();
          return List.<Long>of();
        },
        () -> {
          scheduler.poll();
          return List.<Long>of();
        });

    verify(graphApiClient, times(3)).sendMail(any(), any());
    assertThat(sentSubjects(1L, acc)).containsExactlyInAnyOrder("동시 0", "동시 1", "동시 2");
    for (long d : drafts) {
      assertThat(draftExists(1L, d)).isFalse();
    }

    // ③ 이미 보내 지워진 행을 sendOne 이 다시 받아도 아무것도 하지 않는다
    TenantContext.set(1L);
    sender.sendOne(drafts.get(0));
    verify(graphApiClient, times(3)).sendMail(any(), any());
  }

  @Test
  void 잡히지_않은_QUEUED_행은_sendOne_이_보내지_않는다() {
    long me = user(1L);
    long acc = account(1L, me);
    long draftId = queuedDue(1L, me, acc, "잡히지 않음");

    TenantContext.set(1L);
    sender.sendOne(draftId);

    verify(graphApiClient, never()).sendMail(any(), any());
    assertThat(state(1L, draftId)).isEqualTo("QUEUED");
  }

  @Test
  void _10분_넘은_SENDING_은_다시_보내지_않고_FAILED_와_확인하지_못함_알림() {
    long me = user(1L);
    long acc = account(1L, me);
    long stuck = queuedDue(1L, me, acc, "멈춘 메일");
    long fresh = queuedDue(1L, me, acc, "막 잡은 메일");
    callInTenant(
        1L,
        () -> {
          dsl.update(MAIL_DRAFT)
              .set(MAIL_DRAFT.SEND_STATE, "SENDING")
              .set(
                  MAIL_DRAFT.SENDING_STARTED_AT,
                  DSL.field("now() - interval '11 minutes'", java.time.OffsetDateTime.class))
              .where(MAIL_DRAFT.ID.eq(stuck))
              .execute();
          // 1분 전에 잡힌(아직 보내는 중일 수 있는) 행은 건드리지 않는다
          return dsl.update(MAIL_DRAFT)
              .set(MAIL_DRAFT.SEND_STATE, "SENDING")
              .set(
                  MAIL_DRAFT.SENDING_STARTED_AT,
                  DSL.field("now() - interval '1 minute'", java.time.OffsetDateTime.class))
              .where(MAIL_DRAFT.ID.eq(fresh))
              .execute();
        });

    scheduler.poll();

    verify(graphApiClient, never()).sendMail(any(), any());
    var row =
        callInTenant(
            1L, () -> dsl.selectFrom(MAIL_DRAFT).where(MAIL_DRAFT.ID.eq(stuck)).fetchOne());
    assertThat(row.getSendState()).isEqualTo("FAILED");
    assertThat(row.getSendError()).isEqualTo("UNKNOWN");
    assertThat(row.getSendAt()).isNull();
    assertThat(state(1L, fresh)).isEqualTo("SENDING");
    assertThat(notices(1L, me))
        .singleElement()
        .satisfies(
            n -> {
              assertThat(n.type()).isEqualTo("MAIL_SEND_FAILED");
              assertThat(n.message()).isEqualTo("멈춘 메일");
              assertThat(n.mailDraftId()).isEqualTo(stuck);
              assertThat(n.mailSendUnknown()).isTrue();
            });
  }

  /**
   * 멈춤 시계는 행마다 전송 직전에 다시 찍는다(코드 리뷰) — 잡기는 회차의 행을 한꺼번에 찍지만 전송은 차례로라, 앞 행들이 오래 걸리면 차례를 기다리던 행이 멈춘 것으로
   * 오인된다. 잡힌 지 9분 된 행을 보내는 순간(전송 목 안에서) sending_started_at 이 방금으로 바뀌어 있어야 한다.
   */
  @Test
  void 전송_직전에_행마다_sending_started_at_을_다시_찍는다() {
    long me = user(1L);
    long acc = account(1L, me);
    long draftId = queuedDue(1L, me, acc, "차례를 기다린 메일");
    callInTenant(
        1L,
        () -> {
          draftRepo.claimDue(20);
          // 앞 행들을 보내느라 9분이 지난 것처럼 잡기 때 찍은 시각을 당긴다
          return dsl.update(MAIL_DRAFT)
              .set(
                  MAIL_DRAFT.SENDING_STARTED_AT,
                  DSL.field("now() - interval '9 minutes'", java.time.OffsetDateTime.class))
              .where(MAIL_DRAFT.ID.eq(draftId))
              .execute();
        });
    List<Boolean> freshAtTransport = new ArrayList<>();
    doAnswer(
            inv -> {
              freshAtTransport.add(
                  callInTenant(
                      1L,
                      () ->
                          dsl.fetchExists(
                              MAIL_DRAFT,
                              MAIL_DRAFT
                                  .ID
                                  .eq(draftId)
                                  .and(
                                      MAIL_DRAFT.SENDING_STARTED_AT.gt(
                                          DSL.field(
                                              "now() - interval '1 minute'",
                                              java.time.OffsetDateTime.class))))));
              return null;
            })
        .when(graphApiClient)
        .sendMail(any(), any());

    TenantContext.set(1L);
    sender.sendOne(draftId);

    assertThat(freshAtTransport).containsExactly(true);
    assertThat(draftExists(1L, draftId)).isFalse();
  }

  @Test
  void 두_테넌트의_대기_행이_각자_보내진다() {
    long t2 = ensureFixtureTenant("mail-send-queue-t2");
    long me1 = user(1L);
    long me2 = user(t2);
    long acc1 = account(1L, me1);
    long acc2 = account(t2, me2);
    long d1 = queuedDue(1L, me1, acc1, "테넌트1 메일");
    long d2 = queuedDue(t2, me2, acc2, "테넌트2 메일");

    scheduler.poll();

    verify(graphApiClient, times(2)).sendMail(any(), any());
    assertThat(sentSubjects(1L, acc1)).containsExactly("테넌트1 메일");
    assertThat(sentSubjects(t2, acc2)).containsExactly("테넌트2 메일");
    assertThat(draftExists(1L, d1)).isFalse();
    assertThat(draftExists(t2, d2)).isFalse();
    // 스케줄러 스레드에 테넌트 문맥을 남기지 않는다
    assertThat(TenantContext.get()).isNull();
  }

  /** 두 작업을 같은 순간에 출발시켜(래치) 결과를 모은다. */
  @SafeVarargs
  private List<List<Long>> runTogether(Callable<List<Long>>... tasks) throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(tasks.length);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<List<Long>>> futures = new ArrayList<>();
      for (Callable<List<Long>> t : tasks) {
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  try {
                    return t.call();
                  } finally {
                    TenantContext.clear();
                  }
                }));
      }
      start.countDown();
      List<List<Long>> out = new ArrayList<>();
      for (Future<List<Long>> f : futures) {
        out.add(f.get(60, TimeUnit.SECONDS));
      }
      return out;
    } finally {
      pool.shutdownNow();
    }
  }
}

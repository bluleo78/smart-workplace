package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 메일 보낼 대기열(WP-1786) 저장소 통합 — 스케줄러가 쓰는 claimDue(SKIP LOCKED)·failStuck, 되돌리기 cancelQueued, 목록에서 대기
 * 행 제외.
 *
 * <p>claimDue 의 동시성은 두 트랜잭션이 실제로 겹쳐야 의미가 있어 테스트 트랜잭션 없이(커밋) 돈다. 시드는 {@link #cleanup} 에서 지운다.
 */
class MailSendQueueRepositoryIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailDraftRepository repo;
  @Autowired EncryptionService encryption;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    com.workplace.global.tenant.TenantContext.set(1L);
  }

  /** 계정(메일·임시저장 CASCADE) → 사용자 순으로 정리. */
  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (!users.isEmpty()) {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.USER_ID.in(users)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
          }
        });
    users.clear();
    com.workplace.global.tenant.TenantContext.clear();
  }

  private long user() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  private long account(long user) {
    return MailTestSupport.seedGraphAccount(dsl, encryption, user);
  }

  /** 임시저장 행을 직접 심는다 — state 가 null 이면 일반 임시보관. */
  private long seed(
      long user, long account, String state, OffsetDateTime sendAt, OffsetDateTime startedAt) {
    return callInTenant(
        1L,
        () ->
            dsl.insertInto(MAIL_DRAFT)
                .set(MAIL_DRAFT.USER_ID, user)
                .set(MAIL_DRAFT.ACCOUNT_ID, account)
                .set(MAIL_DRAFT.SUBJECT, "제목")
                .set(MAIL_DRAFT.SEND_STATE, state)
                .set(MAIL_DRAFT.SEND_AT, sendAt)
                .set(MAIL_DRAFT.SENDING_STARTED_AT, startedAt)
                .returning(MAIL_DRAFT.ID)
                .fetchOne()
                .getId());
  }

  private String stateOf(long draftId) {
    return callInTenant(
        1L,
        () ->
            dsl.select(MAIL_DRAFT.SEND_STATE)
                .from(MAIL_DRAFT)
                .where(MAIL_DRAFT.ID.eq(draftId))
                .fetchOne(MAIL_DRAFT.SEND_STATE));
  }

  @Test
  void claimDue_잡은_행은_SENDING_이고_두번째_잡기는_비어있다() {
    long u = user();
    long id = seed(u, account(u), "QUEUED", OffsetDateTime.now().minusSeconds(5), null);

    assertThat(callInTenant(1L, () -> repo.claimDue(20))).containsExactly(id);
    assertThat(stateOf(id)).isEqualTo("SENDING");
    assertThat(callInTenant(1L, () -> repo.claimDue(20))).isEmpty();
  }

  @Test
  void claimDue_두_트랜잭션이_겹쳐도_한쪽만_잡는다() throws Exception {
    long u = user();
    long id = seed(u, account(u), "QUEUED", OffsetDateTime.now().minusSeconds(5), null);

    CountDownLatch firstClaimed = new CountDownLatch(1);
    CountDownLatch secondDone = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      // 첫 트랜잭션은 잡은 뒤 커밋하지 않고 둘째가 끝나기를 기다린다 — 행 잠금을 쥔 채 겹치게 한다.
      Future<List<Long>> first =
          pool.submit(
              () ->
                  callInTenant(
                      1L,
                      () -> {
                        List<Long> got = repo.claimDue(20);
                        firstClaimed.countDown();
                        try {
                          secondDone.await(10, TimeUnit.SECONDS);
                        } catch (InterruptedException e) {
                          Thread.currentThread().interrupt();
                        }
                        return got;
                      }));
      assertThat(firstClaimed.await(10, TimeUnit.SECONDS)).isTrue();
      Future<List<Long>> second = pool.submit(() -> callInTenant(1L, () -> repo.claimDue(20)));
      List<Long> secondGot = second.get(10, TimeUnit.SECONDS);
      secondDone.countDown();
      List<Long> firstGot = first.get(10, TimeUnit.SECONDS);

      List<Long> all = new ArrayList<>(firstGot);
      all.addAll(secondGot);
      assertThat(all).containsExactly(id);
    } finally {
      secondDone.countDown();
      pool.shutdownNow();
    }
  }

  @Test
  void markQueued_이미_QUEUED_나_SENDING_이면_거절한다() {
    long u = user();
    long acc = account(u);
    long queued = seed(u, acc, "QUEUED", OffsetDateTime.now().plusSeconds(10), null);
    long sending = seed(u, acc, "SENDING", OffsetDateTime.now(), OffsetDateTime.now());
    long plain = seed(u, acc, null, null, null);

    assertThat(callInTenant(1L, () -> repo.markQueued(queued, OffsetDateTime.now(), true)))
        .isFalse();
    assertThat(callInTenant(1L, () -> repo.markQueued(sending, OffsetDateTime.now(), true)))
        .isFalse();
    assertThat(stateOf(sending)).isEqualTo("SENDING");
    assertThat(callInTenant(1L, () -> repo.markQueued(plain, OffsetDateTime.now(), true))).isTrue();
    assertThat(stateOf(plain)).isEqualTo("QUEUED");
  }

  @Test
  void markFailed_SENDING_이_아니면_거절한다() {
    long u = user();
    long acc = account(u);
    long plain = seed(u, acc, null, null, null);
    long sending = seed(u, acc, "SENDING", OffsetDateTime.now(), OffsetDateTime.now());

    assertThat(callInTenant(1L, () -> repo.markFailed(plain, "x"))).isFalse();
    assertThat(stateOf(plain)).isNull();
    assertThat(callInTenant(1L, () -> repo.markFailed(sending, "x"))).isTrue();
    assertThat(stateOf(sending)).isEqualTo("FAILED");
  }

  @Test
  void cancelQueued_SENDING_이면_false() {
    long u = user();
    long id = seed(u, account(u), "SENDING", OffsetDateTime.now(), OffsetDateTime.now());

    assertThat(callInTenant(1L, () -> repo.cancelQueued(u, id))).isFalse();
    assertThat(stateOf(id)).isEqualTo("SENDING");
  }

  @Test
  void cancelQueued_QUEUED_면_true_이고_목록에_다시_보인다() {
    long u = user();
    long acc = account(u);
    long id = seed(u, acc, "QUEUED", OffsetDateTime.now().plusSeconds(10), null);
    assertThat(callInTenant(1L, () -> repo.listByAccount(u, acc, 50))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.countByAccount(u, acc).queued())).isEqualTo(1);

    assertThat(callInTenant(1L, () -> repo.cancelQueued(u, id))).isTrue();

    assertThat(stateOf(id)).isNull();
    assertThat(callInTenant(1L, () -> repo.sendState(u, id))).contains("");
    assertThat(callInTenant(1L, () -> repo.listByAccount(u, acc, 50)))
        .extracting(s -> s.id())
        .containsExactly(id);
  }

  /** 회차 시간 예산이 지나 못 보낸 잡은 행(WP-1786 코드 리뷰) — SENDING 만 QUEUED 로, 멈춤 시계를 비워 멈춤 정리에 걸리지 않게. */
  @Test
  void releaseClaimed_SENDING_만_QUEUED_로_되돌리고_다음_잡기가_다시_집는다() {
    long u = user();
    long acc = account(u);
    OffsetDateTime now = OffsetDateTime.now();
    long claimed = seed(u, acc, "QUEUED", now.minusSeconds(5), null);
    long failed = seed(u, acc, "FAILED", null, null);
    assertThat(callInTenant(1L, () -> repo.claimDue(20))).containsExactly(claimed);

    assertThat(callInTenant(1L, () -> repo.releaseClaimed(java.util.List.of(claimed, failed))))
        .isEqualTo(1);

    assertThat(stateOf(claimed)).isEqualTo("QUEUED");
    assertThat(stateOf(failed)).isEqualTo("FAILED");
    var row =
        callInTenant(
            1L, () -> dsl.selectFrom(MAIL_DRAFT).where(MAIL_DRAFT.ID.eq(claimed)).fetchOne());
    assertThat(row.getSendingStartedAt()).isNull();
    assertThat(row.getSendAt()).isNotNull();
    // 오래 기다려도 멈춤 정리에 걸리지 않고, 다음 회차가 다시 집는다.
    assertThat(callInTenant(1L, () -> repo.failStuck(Duration.ZERO))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.claimDue(20))).containsExactly(claimed);
  }

  @Test
  void failStuck_10분_지난_SENDING_만_FAILED() {
    long u = user();
    long acc = account(u);
    OffsetDateTime now = OffsetDateTime.now();
    long old = seed(u, acc, "SENDING", now.minusMinutes(11), now.minusMinutes(11));
    long fresh = seed(u, acc, "SENDING", now.minusMinutes(1), now.minusMinutes(1));

    var stuck = callInTenant(1L, () -> repo.failStuck(Duration.ofMinutes(10)));

    assertThat(stuck).extracting(MailDraftRepository.StuckRow::id).containsExactly(old);
    assertThat(stuck.get(0).userId()).isEqualTo(u);
    assertThat(stuck.get(0).subject()).isEqualTo("제목");
    assertThat(stateOf(old)).isEqualTo("FAILED");
    assertThat(stateOf(fresh)).isEqualTo("SENDING");
    var row =
        callInTenant(1L, () -> dsl.selectFrom(MAIL_DRAFT).where(MAIL_DRAFT.ID.eq(old)).fetchOne());
    assertThat(row.getSendError()).isEqualTo("UNKNOWN");
    assertThat(row.getSendAt()).isNull();
  }

  @Test
  void listByAccount_대기_행은_빼고_FAILED_는_보인다() {
    long u = user();
    long acc = account(u);
    seed(u, acc, "QUEUED", OffsetDateTime.now().plusSeconds(10), null);
    long failed = seed(u, acc, "FAILED", null, null);
    long plain = seed(u, acc, null, null, null);

    assertThat(callInTenant(1L, () -> repo.listByAccount(u, acc, 50)))
        .extracting(s -> s.id())
        .containsExactlyInAnyOrder(failed, plain);
    assertThat(callInTenant(1L, () -> repo.countByAccount(u, acc).count())).isEqualTo(2);
  }
}

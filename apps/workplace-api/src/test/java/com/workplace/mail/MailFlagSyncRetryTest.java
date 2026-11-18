package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.records.EmailMessageRecord;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.DueSeenPushAccount;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailReadSyncDispatcher;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-1741 별표 역동기화 재시도 — 반영이 실패해도 로컬 별표는 남고(대기·백오프 기록), 시각이 지나면 재시도 배치 경로(계정 조회 + 계정 단위 디스패치)가 다시
 * 보낸다. 읽음·별표 재시도 상태는 따로라 한쪽 포기가 다른 쪽 대기를 풀지 않는다.
 *
 * <p><b>@Transactional 금지</b>: 리스·해제가 각자 짧은 트랜잭션으로 커밋돼야 한다(MailReadSyncOrderingTest 와 같은 구성). 재시도
 * 배치 전체 순회는 다른 테스트의 시드까지 건드리므로 부르지 않고, 배치가 쓰는 계정 조회와 계정 단위 디스패치를 각각 검증한다.
 */
class MailFlagSyncRetryTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailReadSyncDispatcher dispatcher;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired PlatformTransactionManager txManager;
  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;

  private Long seededUser;
  private Long seededAccount;

  @AfterEach
  void cleanup() {
    if (seededAccount != null) {
      cleanupInTenant(
          1L,
          () -> dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(seededAccount)).execute());
    }
    if (seededUser != null) {
      cleanupInTenant(1L, () -> dsl.deleteFrom(USER).where(USER.ID.eq(seededUser)).execute());
    }
    TenantContext.clear();
  }

  /** tenant 1 에 사용자·Graph 계정·메일 하나를 커밋하고 메일 id 를 돌려준다. 토큰 조회는 FAKE_TOKEN. */
  private long seed(String providerMessageId) {
    dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    long id = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, providerMessageId);
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    TenantContext.set(1L);
    return id;
  }

  private <T> T inTx(java.util.function.Supplier<T> body) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(s -> body.get());
  }

  private EmailMessageRecord row(long id) {
    return inTx(() -> dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(id)).fetchOne());
  }

  /** 요청마다 200. */
  private static List<GraphBatchResponse> ok(List<GraphBatchRequest> reqs) {
    return reqs.stream().map(rq -> new GraphBatchResponse(rq.id(), 200)).toList();
  }

  /** 실패하면 로컬 별표는 그대로·대기 유지·백오프, 시각이 지나면 배치 경로가 다시 보내 대기를 푼다. 본문은 flag 만(읽음은 보내지 않음). */
  @SuppressWarnings("unchecked")
  @Test
  void failure_keepsLocalFlag_thenRetriedWhenDue() {
    long id = seed("AAFLAGRETRY");
    cleanupInTenant(1L, () -> messageRepo.markFlagged(id, true));
    doThrow(new RuntimeException("boom")).when(graphApiClient).batch(any(), anyList());

    dispatcher.dispatchAccount(seededUser, seededAccount);

    EmailMessageRecord failed = row(id);
    assertThat(failed.getFlagged()).isTrue();
    assertThat(failed.getFlaggedPushPending()).isTrue();
    assertThat(failed.getFlaggedPushAttempts()).isEqualTo(1);
    assertThat(failed.getFlaggedPushNextAt()).isAfter(dbNow());
    assertThat(failed.getSeenPushPending()).isFalse(); // 읽음 쪽은 건드리지 않는다
    assertThat(failed.getSeenPushAttempts()).isZero();
    // 백오프 중 — 배치 대상 아님
    assertThat(inTx(() -> messageRepo.findAccountsWithDueSeenPush()))
        .extracting(DueSeenPushAccount::accountId)
        .doesNotContain(seededAccount);

    // 백오프 시각 경과 + 서버 회복
    cleanupInTenant(
        1L,
        () ->
            dsl.update(EMAIL_MESSAGE)
                .set(
                    EMAIL_MESSAGE.FLAGGED_PUSH_NEXT_AT,
                    DSL.field("now() - interval '1 second'", OffsetDateTime.class))
                .where(EMAIL_MESSAGE.ID.eq(id))
                .execute());
    assertThat(inTx(() -> messageRepo.findAccountsWithDueSeenPush()))
        .contains(new DueSeenPushAccount(seededAccount, seededUser));
    reset(graphApiClient);
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(inv -> ok(inv.getArgument(1)));

    dispatcher.dispatchAccount(seededUser, seededAccount);

    ArgumentCaptor<List<GraphBatchRequest>> cap = ArgumentCaptor.forClass(List.class);
    verify(graphApiClient).batch(eq("FAKE_TOKEN"), cap.capture());
    assertThat(cap.getValue().get(0).url()).isEqualTo("/me/messages/AAFLAGRETRY");
    assertThat(cap.getValue().get(0).body())
        .containsOnlyKeys("flag")
        .containsEntry("flag", Map.of("flagStatus", "flagged"));
    EmailMessageRecord done = row(id);
    assertThat(done.getFlagged()).isTrue();
    assertThat(done.getFlaggedPushPending()).isFalse();
    assertThat(done.getFlaggedPushAttempts()).isZero();
    assertThat(done.getFlaggedPushNextAt()).isNull();
  }

  /** 읽음·별표 둘 다 대기면 한 PATCH 에 둘 다 싣고, 성공하면 둘 다 푼다. */
  @SuppressWarnings("unchecked")
  @Test
  void bothPending_sentInOnePatch_andBothCleared() {
    long id = seed("AABOTH");
    cleanupInTenant(
        1L,
        () -> {
          messageRepo.markSeen(id);
          messageRepo.markFlagged(id, true);
        });
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(inv -> ok(inv.getArgument(1)));

    dispatcher.dispatchAccount(seededUser, seededAccount);

    ArgumentCaptor<List<GraphBatchRequest>> cap = ArgumentCaptor.forClass(List.class);
    verify(graphApiClient).batch(eq("FAKE_TOKEN"), cap.capture());
    assertThat(cap.getValue()).hasSize(1);
    assertThat(cap.getValue().get(0).body())
        .containsEntry("isRead", true)
        .containsEntry("flag", Map.of("flagStatus", "flagged"));
    EmailMessageRecord done = row(id);
    assertThat(done.getSeenPushPending()).isFalse();
    assertThat(done.getFlaggedPushPending()).isFalse();
  }

  /** 별표 재시도가 상한에 닿아 포기해도 읽음 대기는 남는다(재시도 상태가 속성별로 따로). */
  @Test
  void flagGiveUp_doesNotClearSeenPending() {
    long id = seed("AAGIVEUPFLAG");
    cleanupInTenant(
        1L,
        () -> {
          messageRepo.markSeen(id);
          messageRepo.markFlagged(id, true);
          dsl.update(EMAIL_MESSAGE)
              .set(EMAIL_MESSAGE.FLAGGED_PUSH_ATTEMPTS, 7) // MAX_ATTEMPTS(8) - 1
              .where(EMAIL_MESSAGE.ID.eq(id))
              .execute();
        });
    doThrow(new RuntimeException("boom")).when(graphApiClient).batch(any(), anyList());

    dispatcher.dispatchAccount(seededUser, seededAccount);

    EmailMessageRecord r = row(id);
    assertThat(r.getFlaggedPushPending()).isFalse(); // 포기 — 다음 동기화는 서버 별표를 따른다
    assertThat(r.getFlagged()).isTrue(); // 로컬 값은 그대로
    assertThat(r.getSeenPushPending()).isTrue(); // 읽음은 계속 재시도
    assertThat(r.getSeenPushAttempts()).isEqualTo(1);
  }
}

package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.event.MessagesSeenChangedEvent;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailReadSyncDispatcher;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 읽음 역동기화 E2E 흐름 통합 테스트.
 *
 * <p>Graph 계정 메시지(seen=false)를 시드한 뒤 {@link MailMessageService#get}을 호출해 seen=true 로 전이시키면,
 * AFTER_COMMIT @Async 리스너가 {@link GraphApiClient#batch}를 호출하는지 검증한다(WP-187 — 일괄 이벤트·$batch).
 *
 * <p><b>@Transactional 금지</b>: markSeen 은 내부 짧은 트랜잭션으로 커밋하므로, 테스트 메서드가 @Transactional 이면
 * AFTER_COMMIT 이벤트가 발화하지 않는다. 대신 @AfterEach 에서 시드된 데이터를 명시적으로 삭제한다(#512 non-tx 격리 패턴).
 *
 * <p>비동기 검증: Awaitility 의존이 없으므로 Mockito 내장 {@code timeout(ms)} 로 최대 5초 대기한다.
 */
class MailReadSyncFlowTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailMessageService messageService;
  @Autowired MailReadSyncDispatcher dispatcher;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;
  @Autowired EmailMessageRepository messageRepo;

  /** Graph HTTP 호출 차단 + 호출 검증 대상. */
  @MockitoBean GraphApiClient graphApiClient;

  /** 실제 token 교환 차단 — FAKE_TOKEN 을 반환하도록 stubbing. */
  @MockitoBean GraphTokenService graphTokenService;

  private Long seededUser;
  private Long seededAccount;
  private Long seededMessage;

  // ── 세션 GUC 헬퍼 ──────────────────────────────────────────────────────────

  /** 세션 GUC 설정(is_local=false) — 트랜잭션 밖 시드/정리용. */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  @AfterEach
  void cleanup() {
    // RLS-safe 삭제: cleanupInTenant 헬퍼로 GUC 주입 후 account CASCADE 삭제(folder/message 포함)
    if (seededAccount != null) {
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(seededAccount)).execute();
          });
    }
    if (seededUser != null) {
      setSessionGuc(1L);
      dsl.deleteFrom(USER).where(USER.ID.eq(seededUser)).execute();
    }
    TenantContext.clear();
  }

  /**
   * 첫 열람(seen false→true) 후 Graph PATCH 가 호출되는지 검증한다.
   *
   * <p>흐름: seedUnseenGraphMessage → TenantContext.set(1) → messageService.get() → markSeen 커밋 →
   * AFTER_COMMIT 이벤트 → @Async 리스너 → MailReadSyncDispatcher(@Transactional) → GraphReadSyncer →
   * GraphApiClient.patch (Mockito timeout 검증).
   */
  @SuppressWarnings("unchecked")
  @Test
  void firstRead_graphAccount_syncsIsReadToServer() {
    // 시드: tenant 1 컨텍스트에서 사용자·Graph 계정·미읽음 메시지를 커밋
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    seededMessage = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, "AAGRAPHID");

    // GraphTokenService 모킹: accountId 스코프 토큰 반환
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    // 스텁이 없으면 목이 빈 응답을 돌려줘 성공 항목이 없다 — 열람 전에 건다
    stubBatchOk(seededMessage);

    // 서비스 호출: 테넌트 컨텍스트를 세팅해 RLS GUC 주입이 동작하도록 한다
    TenantContext.set(1L);
    messageService.get(seededUser, seededMessage, true); // seen false→true 커밋 → AFTER_COMMIT 이벤트

    // 비동기 리스너가 Graph $batch 로 PATCH isRead=true 를 보내는지 최대 5초 대기
    ArgumentCaptor<List<GraphBatchRequest>> cap = ArgumentCaptor.forClass(List.class);
    verify(graphApiClient, org.mockito.Mockito.timeout(5_000))
        .batch(eq("FAKE_TOKEN"), cap.capture());
    GraphBatchRequest rq = cap.getValue().get(0);
    org.assertj.core.api.Assertions.assertThat(rq.method()).isEqualTo("PATCH");
    org.assertj.core.api.Assertions.assertThat(rq.url()).isEqualTo("/me/messages/AAGRAPHID");
    org.assertj.core.api.Assertions.assertThat(rq.body()).containsEntry("isRead", true);
  }

  /** $batch 성공 스텁 — 주어진 메일 id 마다 200. */
  private void stubBatchOk(long... messageIds) {
    List<GraphBatchResponse> ok = new ArrayList<>();
    for (long id : messageIds) {
      ok.add(new GraphBatchResponse(String.valueOf(id), 200));
    }
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList())).thenReturn(ok);
  }

  /**
   * 두 번째 열람(already seen=true)에서는 이벤트가 발행되지 않아 PATCH 가 추가 호출되지 않는다.
   *
   * <p>seen=true 로 이미 DB에 있으면 markSeen 분기에 진입하지 않으므로, GraphApiClient 호출 횟수는 첫 열람의 1회에서 증가하지 않는다.
   */
  @Test
  void secondRead_alreadySeen_doesNotSyncAgain() {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    // seen=true 로 직접 삽입 — 첫 열람이 없었던 것처럼 시드
    long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, seededAccount)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    seededMessage =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, seededAccount)
            .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
            .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, "AAGRAPHID_SEEN")
            .set(EMAIL_MESSAGE.THREAD_ID, "thread-seen")
            .set(EMAIL_MESSAGE.SEEN, true) // 이미 읽음
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();

    TenantContext.set(1L);
    messageService.get(seededUser, seededMessage, true); // seen=true 이미라 markSeen 분기 미진입

    // PATCH 가 호출되지 않아야 한다(짧은 대기 후 0건 검증)
    org.mockito.Mockito.verifyNoInteractions(graphApiClient);
  }

  /** 서버 반영 대기 표시 조회(WP-148). */
  private boolean pushPending(long messageId) {
    return Boolean.TRUE.equals(
        dsl.select(EMAIL_MESSAGE.SEEN_PUSH_PENDING)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .fetchOne(EMAIL_MESSAGE.SEEN_PUSH_PENDING));
  }

  /** WP-148: Graph $batch 성공 → dispatcher 가 서버 반영 대기를 푼다. */
  @Test
  void dispatch_success_clearsPushPending() throws Exception {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    seededMessage = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, "AAGRAPHID_OK");
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    stubBatchOk(seededMessage);

    TenantContext.set(1L);
    messageService.get(seededUser, seededMessage, true);
    verify(graphApiClient, org.mockito.Mockito.timeout(5_000)).batch(eq("FAKE_TOKEN"), anyList());

    long deadline = System.currentTimeMillis() + 5_000;
    while (pushPending(seededMessage) && System.currentTimeMillis() < deadline) {
      Thread.sleep(50);
    }
    org.assertj.core.api.Assertions.assertThat(pushPending(seededMessage)).isFalse();
  }

  /** WP-148: Graph $batch 실패(예외) → 서버 반영 대기가 유지된다. */
  @Test
  void dispatch_failure_keepsPushPending() throws Exception {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    seededMessage = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, "AAGRAPHID_FAIL");
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    org.mockito.Mockito.doThrow(new RuntimeException("429"))
        .when(graphApiClient)
        .batch(any(), anyList());

    TenantContext.set(1L);
    messageService.get(seededUser, seededMessage, true);
    verify(graphApiClient, org.mockito.Mockito.timeout(5_000)).batch(eq("FAKE_TOKEN"), anyList());
    Thread.sleep(300); // 리스너가 예외를 흡수·종료할 시간

    org.assertj.core.api.Assertions.assertThat(pushPending(seededMessage)).isTrue();
  }

  /** WP-148: 건너뜀(IMAP uid 없는 로컬 생성 행)은 다시 해도 반영할 수 없으므로 예외 없이 끝나고 대기 표시가 풀린다. */
  @Test
  void dispatch_skipped_clearsPushPending() throws Exception {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.insertAccount(accountRepo, encryption, seededUser, false);
    long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, seededAccount)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    seededMessage =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, seededAccount)
            .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
            .set(EMAIL_MESSAGE.THREAD_ID, "thread-skip")
            .set(EMAIL_MESSAGE.SEEN, true)
            .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, true) // imap_uid 없음 → 서버 반영 불가(건너뜀)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();

    TenantContext.set(1L);
    dispatcher.dispatch(
        new MessagesSeenChangedEvent(1L, seededUser, seededAccount, List.of(seededMessage)));

    org.assertj.core.api.Assertions.assertThat(pushPending(seededMessage)).isFalse();
  }

  /** WP-187: 동기화 중 사용자가 다시 바꿨다면(서버엔 true 를 보냈는데 지금 seen=false) 대기 표시를 유지한다. */
  @Test
  void dispatch_userChangedDuringSync_keepsPending() throws Exception {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    seededMessage = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, "AAGRAPHID_RACE");
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    TenantContext.set(1L);
    cleanupInTenant(1L, () -> messageRepo.markSeen(seededMessage));
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(
            inv -> {
              // 서버 호출 도중 사용자가 되돌림(조각 트랜잭션에 합류해 같은 tx 안에서 바뀐다 — 조건부 UPDATE 의미는 같다)
              cleanupInTenant(1L, () -> messageRepo.markUnseen(seededMessage));
              return List.of(new GraphBatchResponse(String.valueOf(seededMessage), 200));
            });

    dispatcher.dispatch(
        new MessagesSeenChangedEvent(1L, seededUser, seededAccount, List.of(seededMessage)));

    org.assertj.core.api.Assertions.assertThat(pushPending(seededMessage)).isTrue();
  }

  /** WP-187: 한 묶음에서 200 인 메일만 대기를 풀고, 429 인 메일은 대기를 유지한다. */
  @Test
  void dispatch_partial429_clearsOnlySucceeded() throws Exception {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    seededMessage = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, "AAGRAPHID_P1");
    long other = insertPendingGraphMessage("AAGRAPHID_P2");
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    TenantContext.set(1L);
    cleanupInTenant(1L, () -> messageRepo.markSeen(seededMessage));
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenReturn(
            List.of(
                new GraphBatchResponse(String.valueOf(other), 429),
                new GraphBatchResponse(String.valueOf(seededMessage), 200)));

    dispatcher.dispatch(
        new MessagesSeenChangedEvent(1L, seededUser, seededAccount, List.of(seededMessage, other)));

    org.assertj.core.api.Assertions.assertThat(pushPending(seededMessage)).isFalse();
    org.assertj.core.api.Assertions.assertThat(pushPending(other)).isTrue();
  }

  /** WP-187(R2): 조각마다 트랜잭션이 따로라, 두 번째 조각(201번째 메일)에서 처리기가 예외를 던져도 첫 조각 200통의 대기 해제는 커밋된 채 남는다. */
  @SuppressWarnings("unchecked")
  @Test
  void dispatch_laterChunkFails_keepsEarlierClears() throws Exception {
    setSessionGuc(1L);
    seededUser = TestFixtures.createHuman(dsl);
    seededAccount = MailTestSupport.seedGraphAccount(dsl, seededUser);
    seededMessage = MailTestSupport.seedUnseenGraphMessage(dsl, seededAccount, "AAGRAPHID_C0");
    List<Long> ids = new ArrayList<>();
    for (int i = 1; i <= 201; i++) {
      ids.add(insertPendingGraphMessage("AAGRAPHID_C" + i));
    }
    long last = ids.get(200);
    when(graphTokenService.getAccessToken(seededUser, seededAccount)).thenReturn("FAKE_TOKEN");
    when(graphApiClient.batch(eq("FAKE_TOKEN"), anyList()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              if (reqs.stream().anyMatch(rq -> rq.id().equals(String.valueOf(last)))) {
                throw new RuntimeException("boom"); // 두 번째 조각 — 장애
              }
              return reqs.stream().map(rq -> new GraphBatchResponse(rq.id(), 200)).toList();
            });

    TenantContext.set(1L);
    dispatcher.dispatch(new MessagesSeenChangedEvent(1L, seededUser, seededAccount, ids));

    org.assertj.core.api.Assertions.assertThat(ids.subList(0, 200))
        .allSatisfy(id -> org.assertj.core.api.Assertions.assertThat(pushPending(id)).isFalse());
    org.assertj.core.api.Assertions.assertThat(pushPending(last)).isTrue();
  }

  /** seedUnseenGraphMessage 가 만든 INBOX 에 읽음·반영 대기 Graph 메일을 하나 더 넣는다(같은 계정 두 번째 이후 메일용). */
  private long insertPendingGraphMessage(String providerMessageId) {
    long folderId =
        dsl.select(EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ACCOUNT_ID.eq(seededAccount))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .fetchOne(EMAIL_FOLDER.ID);
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, seededAccount)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, providerMessageId)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + providerMessageId)
        .set(EMAIL_MESSAGE.SEEN, true)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, true)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }
}

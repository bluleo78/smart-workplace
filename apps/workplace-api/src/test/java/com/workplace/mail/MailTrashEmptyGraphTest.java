package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailTrashEmptyStatus;
import com.workplace.mail.exception.MailCredentialUnreadableException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.mail.service.graph.GraphMailFolder;
import com.workplace.mail.service.graph.GraphMessageIdPage;
import com.workplace.mail.service.trash.GraphMailEraser;
import com.workplace.mail.service.trash.MailTrashEmptyProgress;
import com.workplace.mail.service.trash.MailTrashService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * 휴지통 비우기(WP-1682) Outlook(Graph) 통합 테스트 — {@link GraphApiClient}·{@link GraphTokenService} 를 스텁한다.
 * 비우기는 휴지통 id 목록을 nextLink 끝까지 다 받은 뒤에야 지우기 시작하고, 20건씩 permanentDelete 를 보내며, 항목 429·503·504 는
 * Retry-After 만큼(없으면 5초, 30초 상한) 기다려 그 항목만 다시 보낸다 — 처음 보낸 뒤 최대 3번 다시(모두 4번) 보내고 그래도 안 되면 실패로 센다.
 * batch 최상위 실패는 2·5·10초 뒤 다시 보내고 네 번째도 실패하면 FAILED(SERVER_UNREACHABLE)이며 그때도 {@code deleted +
 * failed == total} 이다.
 *
 * <p>지우기 전에 묶음마다 위치 확인 GET 을 같은 $batch(같은 재시도)로 보내 스냅샷 뒤 지운 편지함 밖으로 옮겨진 메일은 지우지 않고 실패로 센다. 스텁은 GET
 * 요청에 기본으로 「지운 편지함에 있음」을 답하고({@link #locate} 로 바꾼다), permanentDelete 요청만 {@link #batches} 에 쌓는다.
 *
 * <p>실행기는 동기 실행기로, 지우개의 대기({@code pauser})는 실제로 자지 않고 기록만 하는 것으로 바꾼다. 이것들과 테스트가 바꾸는 반영 단위({@code
 * localFlush})는 모두 테스트 클래스들이 공유하는 싱글턴 빈의 필드라 {@link #restore()} 에서 원래 값으로 되돌린다.
 */
@Transactional
class MailTrashEmptyGraphTest extends ExternalClientMockedTestBase {

  private static final String TOKEN = "FAKE_TOKEN";
  private static final String FIRST_PAGE =
      "/me/mailFolders/deleteditems/messages?$select=id&$top=500";
  private static final String NEXT_PAGE =
      "https://graph.microsoft.com/v1.0/me/mailFolders/deleteditems/messages?$skiptoken=P2";

  @Autowired DSLContext dsl;
  @Autowired MailTrashService trashService;
  @Autowired MailTrashEmptyProgress progress;
  @Autowired GraphMailEraser graphMailEraser;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;

  private Object originalExecutor;
  private Object originalPauser;
  private Object originalLocalFlush;
  private final List<Long> startedAccounts = new ArrayList<>();

  /** 지우개가 기다리려 한 시간(호출 순서대로) — 실제로는 자지 않는다. */
  private final List<Duration> pauses = new ArrayList<>();

  /** 지운 편지함의 Graph 폴더 id(스텁). */
  private static final String TRASH_FOLDER_ID = "FOLDER-DELETED";

  private static final String TRASH_FOLDER_URL = "/me/mailFolders/deleteditems?$select=id";

  /** 보낸 permanentDelete batch 요청 묶음(호출 순서대로) — 위치 확인 GET 은 {@link #locates} 에 따로 쌓는다. */
  private final List<List<GraphBatchRequest>> batches = new ArrayList<>();

  /** 보낸 위치 확인 GET batch 요청 묶음(호출 순서대로). */
  private final List<List<GraphBatchRequest>> locates = new ArrayList<>();

  /** 위치 확인 응답 — (Graph id, 그 id 를 확인한 횟수, 처음이면 0) → 응답. 기본은 지운 편지함에 있음. */
  private BiFunction<String, Integer, GraphBatchResponse> locate =
      (pid, n) -> locatedIn(TRASH_FOLDER_ID);

  @BeforeEach
  void swapSingletons() {
    originalExecutor = ReflectionTestUtils.getField(trashService, "emptyExecutor");
    originalPauser = ReflectionTestUtils.getField(graphMailEraser, "pauser");
    originalLocalFlush = ReflectionTestUtils.getField(graphMailEraser, "localFlush");
    ReflectionTestUtils.setField(trashService, "emptyExecutor", new SyncTaskExecutor());
    GraphMailEraser.Pauser recording = pauses::add;
    ReflectionTestUtils.setField(graphMailEraser, "pauser", recording);
  }

  @AfterEach
  void restore() {
    ReflectionTestUtils.setField(trashService, "emptyExecutor", originalExecutor);
    ReflectionTestUtils.setField(graphMailEraser, "pauser", originalPauser);
    ReflectionTestUtils.setField(graphMailEraser, "localFlush", originalLocalFlush);
    // 진행 상태도 싱글턴이다 — 이 클래스가 시작한 계정은 시작 전으로 되돌린다
    // 정리는 테넌트 문맥이 있어야 지운다(없으면 discardForTest 가 건너뛴다) — 요청 처리 뒤 문맥이 비어 있을 수 있어 세운다.
    TenantContext.runAs(1L, () -> startedAccounts.forEach(progress::discardForTest));
  }

  /** [user, account, trashFolderId] — Graph 계정과 휴지통(role TRASH) 행. */
  private long[] setup() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    startedAccounts.add(accountId);
    long trash =
        folderRepo
            .upsertServerFolder(
                accountId, "id-trash", "id-trash", "Deleted Items", "TRASH", true, null, null, null)
            .orElseThrow();
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn(TOKEN);
    when(graphApiClient.get(eq(TOKEN), eq(TRASH_FOLDER_URL), eq(GraphMailFolder.class)))
        .thenReturn(new GraphMailFolder(TRASH_FOLDER_ID, null, null, null, null, null, null, null));
    return new long[] {user, accountId, trash};
  }

  private long seed(long accountId, long folderId, String providerId) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, providerId)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + providerId)
        .set(EMAIL_MESSAGE.SEEN, true)
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 휴지통 id 목록 한 쪽짜리 스텁. */
  private void stubSinglePage(List<String> ids) {
    when(graphApiClient.get(eq(TOKEN), eq(FIRST_PAGE), eq(GraphMessageIdPage.class)))
        .thenReturn(page(ids, null));
  }

  private static GraphMessageIdPage page(List<String> ids, String nextLink) {
    return new GraphMessageIdPage(
        ids.stream().map(GraphMessageIdPage.Item::new).toList(), nextLink);
  }

  /**
   * batch 스텁 — 같은 Graph id 를 몇 번째 보내는지(0부터)와 id 로 응답을 정한다. 요청 묶음은 {@link #batches} 에 쌓는다.
   *
   * @param reply (Graph id, 그 id 를 보낸 횟수 — 처음이면 0) → 응답(요청 id 는 스텁이 맞춘다)
   */
  private void stubBatch(BiFunction<String, Integer, GraphBatchResponse> reply) {
    Map<String, Integer> sends = new HashMap<>();
    Map<String, Integer> located = new HashMap<>();
    when(graphApiClient.batch(eq(TOKEN), any()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              boolean isLocate = isLocate(reqs);
              (isLocate ? locates : batches).add(reqs);
              return reqs.stream()
                  .map(
                      r -> {
                        String pid = providerIdOf(r);
                        Map<String, Integer> counts = isLocate ? located : sends;
                        int n = counts.merge(pid, 1, Integer::sum) - 1;
                        GraphBatchResponse g =
                            isLocate ? locate.apply(pid, n) : reply.apply(pid, n);
                        return new GraphBatchResponse(
                            r.id(), g.status(), g.body(), g.retryAfterSeconds());
                      })
                  .toList();
            });
  }

  /** 위치 확인 GET 묶음인지. */
  private static boolean isLocate(List<GraphBatchRequest> reqs) {
    return !reqs.isEmpty() && "GET".equals(reqs.get(0).method());
  }

  /** 위치 확인 200 응답 — 메일이 folderId 메일함에 있다. */
  private static GraphBatchResponse locatedIn(String folderId) {
    return new GraphBatchResponse(
        "", 200, JsonNodeFactory.instance.objectNode().put("parentFolderId", folderId));
  }

  private static GraphBatchResponse status(int status) {
    return new GraphBatchResponse("", status);
  }

  private static GraphBatchResponse throttled(Integer retryAfter) {
    return new GraphBatchResponse("", 429, null, retryAfter);
  }

  /** permanentDelete·위치 확인 요청 URL 에서 Graph 메시지 id 를 꺼낸다. */
  private static String providerIdOf(GraphBatchRequest r) {
    return r.url()
        .replace("/me/mailFolders/deleteditems/messages/", "")
        .replace("/permanentDelete", "")
        .replace("/me/messages/", "")
        .replace("?$select=id,parentFolderId", "");
  }

  private int trashRows(long trashFolderId) {
    return dsl.fetchCount(EMAIL_MESSAGE, EMAIL_MESSAGE.FOLDER_ID.eq(trashFolderId));
  }

  @Test
  void empty_followsNextLinkFirst_thenDeletes_andClearsLocal() {
    long[] s = setup();
    seed(s[1], s[2], "A1");
    seed(s[1], s[2], "A4");
    when(graphApiClient.get(eq(TOKEN), eq(FIRST_PAGE), eq(GraphMessageIdPage.class)))
        .thenReturn(page(List.of("A1", "A2", "A3"), NEXT_PAGE));
    when(graphApiClient.get(eq(TOKEN), eq(NEXT_PAGE), eq(GraphMessageIdPage.class)))
        .thenReturn(page(List.of("A4"), null));
    stubBatch((pid, n) -> status(204));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    // 지우면서 쪽을 넘기면 건너뛰는 메일이 생긴다 — 두 쪽을 다 받은 뒤에야 첫 batch(위치 확인 → 지우기)
    InOrder order = inOrder(graphApiClient);
    order.verify(graphApiClient).get(eq(TOKEN), eq(FIRST_PAGE), eq(GraphMessageIdPage.class));
    order.verify(graphApiClient).get(eq(TOKEN), eq(NEXT_PAGE), eq(GraphMessageIdPage.class));
    order.verify(graphApiClient, org.mockito.Mockito.times(2)).batch(eq(TOKEN), any());
    assertThat(locates)
        .singleElement()
        .satisfies(
            b ->
                assertThat(b)
                    .extracting(r -> providerIdOf(r))
                    .containsExactly("A1", "A2", "A3", "A4"));
    assertThat(batches)
        .singleElement()
        .satisfies(
            b -> {
              assertThat(b)
                  .extracting(r -> providerIdOf(r))
                  .containsExactly("A1", "A2", "A3", "A4");
              assertThat(b).allSatisfy(r -> assertThat(r.method()).isEqualTo("POST"));
              assertThat(b).allSatisfy(r -> assertThat(r.body()).isEqualTo(Map.of()));
            });
    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.total()).isEqualTo(4);
    assertThat(st.deleted()).isEqualTo(4);
    assertThat(st.failed()).isZero();
    assertThat(trashRows(s[2])).isZero();
    assertThat(pauses).isEmpty();
  }

  /** 다시 보낼 항목들의 대기는 그 항목들 Retry-After 의 최댓값이고 30초를 넘지 않는다. */
  @Test
  void itemRetryAfter_isMaxOfItems_cappedAt30s() {
    long[] s = setup();
    stubSinglePage(List.of("A1", "A2"));
    stubBatch(
        (pid, n) -> {
          if (n > 0) {
            return status(204);
          }
          return "A1".equals(pid) ? throttled(null) : throttled(120);
        });

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(pauses).containsExactly(Duration.ofSeconds(30));
    assertThat(batches).extracting(List::size).containsExactly(2, 2); // 다시 보낼 때도 그 둘만
    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.deleted()).isEqualTo(2);
    assertThat(st.failed()).isZero();
  }

  /** Retry-After 가 없으면 5초 기다린다. 다시 보낼 때는 그 항목만 싣는다. */
  @Test
  void itemRetryAfter_defaultsTo5s() {
    long[] s = setup();
    stubSinglePage(List.of("A1", "A2"));
    stubBatch((pid, n) -> "A1".equals(pid) && n == 0 ? throttled(null) : status(204));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(pauses).containsExactly(Duration.ofSeconds(5));
    assertThat(batches.get(1)).extracting(r -> providerIdOf(r)).containsExactly("A1");
    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.deleted()).isEqualTo(2);
  }

  /**
   * ITEM_RETRY_MAX=3 은 처음 보낸 뒤 다시 보내는 횟수다(모두 최대 4번). 503·504 도 429 처럼 다시 보낸다. 4번째(다시 보내기 3번째)에 성공하면
   * 지운 것이고, 4번 모두 다시 보낼 응답이면 그 항목만 실패로 세고 작업은 DONE 으로 끝난다. 그 밖의 상태(500)는 다시 보내지 않고 바로 실패다.
   */
  @Test
  void itemRetry_threeRetriesAfterFirstSend_thenFailsOnlyThatItem() {
    long[] s = setup();
    stubSinglePage(List.of("A1", "A2", "A3"));
    stubBatch(
        (pid, n) ->
            switch (pid) {
              case "A1" -> throttled(null); // 4번 모두 429 → 실패
              case "A2" -> n < 3 ? status(n == 0 ? 503 : 504) : status(204); // 4번째에 성공
              default -> status(500); // 다시 보내지 않는다
            });

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(batches).extracting(List::size).containsExactly(3, 2, 2, 2);
    assertThat(pauses)
        .containsExactly(Duration.ofSeconds(5), Duration.ofSeconds(5), Duration.ofSeconds(5));
    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.total()).isEqualTo(3);
    assertThat(st.deleted()).isEqualTo(1);
    assertThat(st.failed()).isEqualTo(2);
  }

  /**
   * batch 최상위 실패는 2·5·10초 뒤 다시 보내고, 네 번째도 실패하면 FAILED(SERVER_UNREACHABLE). 앞 묶음에서 지운 메일은 로컬에도 반영하고
   * 남은 메일은 실패로 세어 {@code deleted + failed == total}.
   */
  @Test
  void topLevelFailsFourTimes_failsServerUnreachable_withDeletedPlusFailedEqualsTotal() {
    long[] s = setup();
    List<String> ids = new ArrayList<>();
    for (int i = 1; i <= 25; i++) {
      ids.add("A" + i);
    }
    long firstChunkRow = seed(s[1], s[2], "A1");
    long secondChunkRow = seed(s[1], s[2], "A21");
    stubSinglePage(ids);
    // 위치 확인은 늘 「지운 편지함에 있음」, permanentDelete 는 첫 묶음만 받고 그 뒤는 최상위 실패
    when(graphApiClient.batch(eq(TOKEN), any()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              if (isLocate(reqs)) {
                return reqs.stream()
                    .map(
                        r -> new GraphBatchResponse(r.id(), 200, locatedIn(TRASH_FOLDER_ID).body()))
                    .toList();
              }
              if (!batches.isEmpty()) {
                throw new MailSendException("batch 실패");
              }
              batches.add(reqs);
              return reqs.stream().map(r -> new GraphBatchResponse(r.id(), 204)).toList();
            });

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(pauses)
        .containsExactly(Duration.ofSeconds(2), Duration.ofSeconds(5), Duration.ofSeconds(10));
    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.SERVER_UNREACHABLE);
    assertThat(st.error())
        .isEqualTo(MailTrashException.messageOf(MailTrashException.SERVER_UNREACHABLE));
    assertThat(st.total()).isEqualTo(25);
    assertThat(st.deleted()).isEqualTo(20);
    assertThat(st.failed()).isEqualTo(5);
    assertThat(st.deleted() + st.failed()).isEqualTo(st.total());
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(firstChunkRow))).isFalse();
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(secondChunkRow))).isTrue();
  }

  /**
   * 성공한 id 는 localFlush 개마다 로컬에 반영하고 끝에 남은 것(5개를 2개씩 → 마지막 1개)도 반영한다 — 모든 휴지통 행이 지워지고 수가 맞는다.
   * localFlush 는 {@link #restore()} 가 되돌린다.
   */
  @Test
  void localFlush_appliesEveryNAndRemainder() {
    long[] s = setup();
    ReflectionTestUtils.setField(graphMailEraser, "localFlush", 2);
    seed(s[1], s[2], "A1");
    seed(s[1], s[2], "A3");
    seed(s[1], s[2], "A5");
    stubSinglePage(List.of("A1", "A2", "A3", "A4", "A5"));
    stubBatch((pid, n) -> status(pid.equals("A4") ? 404 : 204)); // 404 = 이미 없음 → 지운 것

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.deleted()).isEqualTo(5);
    assertThat(trashRows(s[2])).isZero();
  }

  /** 목록 GET 이 실패하면 아무것도 지우지 않고 FAILED(SERVER_UNREACHABLE). */
  @Test
  void listFails_failsServerUnreachable_deletesNothing() {
    long[] s = setup();
    long row = seed(s[1], s[2], "A1");
    when(graphApiClient.get(eq(TOKEN), eq(FIRST_PAGE), eq(GraphMessageIdPage.class)))
        .thenThrow(new com.workplace.mail.exception.MailSyncException("Graph API 호출 실패: 503"));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.SERVER_UNREACHABLE);
    assertThat(batches).isEmpty();
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(row))).isTrue();
  }

  /** 기다리는 중 인터럽트(앱 종료)면 인터럽트 표시를 되살리고 FAILED(INTERRUPTED). 그 전에 지운 메일은 로컬에도 반영돼 있다. */
  @Test
  void interruptedWhilePausing_failsInterrupted_andRestoresFlag() {
    long[] s = setup();
    long row = seed(s[1], s[2], "A2");
    stubSinglePage(List.of("A1", "A2"));
    stubBatch((pid, n) -> "A1".equals(pid) ? throttled(null) : status(204));
    GraphMailEraser.Pauser interrupted =
        d -> {
          throw new InterruptedException("종료");
        };
    ReflectionTestUtils.setField(graphMailEraser, "pauser", interrupted);

    MailTrashEmptyStatus st;
    boolean flag;
    try {
      st = trashService.startEmpty(s[0], s[1]);
    } finally {
      flag = Thread.interrupted(); // 동기 실행기라 이 스레드 — 다음 테스트에 남기지 않게 지운다
    }

    assertThat(flag).isTrue();
    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.INTERRUPTED);
    assertThat(st.deleted()).isEqualTo(1);
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(row))).isFalse();
  }

  /**
   * Graph 는 폴더 범위 경로여도 메시지 id 로 찾아 지운다 — 그래서 묶음마다 위치를 확인한다. 스냅샷 뒤 다른 메일 앱이 받은편지함으로 옮긴 메일(A2)은
   * permanentDelete 를 보내지 않고 실패로 세며 로컬 행도 둔다. 확인 404(A4, 이미 없음)는 지우기 없이 지운 것으로 센다. 확인 GET 의 항목
   * 429(A3)는 지우기와 같이 Retry-After 만큼 기다려 그 항목만 다시 확인한다. {@code deleted + failed == total}.
   */
  @Test
  void messageMovedAfterSnapshot_isNotDeleted_countedFailed() {
    long[] s = setup();
    long movedRow = seed(s[1], s[2], "A2");
    stubSinglePage(List.of("A1", "A2", "A3", "A4"));
    locate =
        (pid, n) ->
            switch (pid) {
              case "A2" -> locatedIn("FOLDER-INBOX");
              case "A3" -> n == 0 ? throttled(7) : locatedIn(TRASH_FOLDER_ID);
              case "A4" -> status(404);
              default -> locatedIn(TRASH_FOLDER_ID);
            };
    stubBatch((pid, n) -> status(204));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(locates).extracting(List::size).containsExactly(4, 1); // 다시 확인할 때는 A3 만
    assertThat(locates.get(0))
        .allSatisfy(
            r -> {
              assertThat(r.method()).isEqualTo("GET");
              assertThat(r.body()).isNull();
              assertThat(r.url())
                  .isEqualTo("/me/messages/" + providerIdOf(r) + "?$select=id,parentFolderId");
            });
    assertThat(pauses).containsExactly(Duration.ofSeconds(7));
    assertThat(batches)
        .singleElement()
        .satisfies(b -> assertThat(b).extracting(r -> providerIdOf(r)).containsExactly("A1", "A3"));
    assertThat(st.state()).isEqualTo("DONE");
    assertThat(st.total()).isEqualTo(4);
    assertThat(st.deleted()).isEqualTo(3);
    assertThat(st.failed()).isEqualTo(1);
    assertThat(st.deleted() + st.failed()).isEqualTo(st.total());
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(movedRow))).isTrue();
  }

  /** 지운 편지함 id 를 받지 못하면 아무것도 지우지 않고 FAILED(SERVER_UNREACHABLE) — 목록도 받지 않는다. */
  @Test
  void trashFolderIdFails_failsServerUnreachable_deletesNothing() {
    long[] s = setup();
    long row = seed(s[1], s[2], "A1");
    when(graphApiClient.get(eq(TOKEN), eq(TRASH_FOLDER_URL), eq(GraphMailFolder.class)))
        .thenThrow(new com.workplace.mail.exception.MailSyncException("Graph API 호출 실패: 503"));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.SERVER_UNREACHABLE);
    assertThat(st.total()).isNull();
    org.mockito.Mockito.verify(graphApiClient, org.mockito.Mockito.never()).batch(any(), any());
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(row))).isTrue();
  }

  /** WP-1907 — M365 토큰을 읽지 못하면 서버 호출 없이 OAUTH_TOKEN_UNREADABLE 로 실패하고 다시 연결 문구를 남긴다. */
  @Test
  void tokenUnreadable_failsOauthTokenUnreadable_noServerCalls() {
    long[] s = setup();
    when(graphTokenService.getAccessToken(anyLong(), anyLong()))
        .thenThrow(MailCredentialUnreadableException.oauthToken(null));

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.OAUTH_TOKEN_UNREADABLE);
    assertThat(st.error()).isEqualTo(MailServerErrors.OAUTH_TOKEN_UNREADABLE);
    verifyNoInteractions(graphApiClient);
  }

  /**
   * WP-1907 — 비우는 도중 토큰을 읽지 못하게 되면(refresh 토큰이 깨짐) 다시 보내며 기다리지 않고 OAUTH_TOKEN_UNREADABLE 로 멈춘다. 이미
   * 지운 첫 묶음은 반영하고, 남은 항목은 실패로 세어 deleted + failed == total 을 지킨다.
   */
  @Test
  void tokenBecomesUnreadableMidRun_failsOauthTokenUnreadable_noRetry_countsAddUp() {
    long[] s = setup();
    List<String> ids = new ArrayList<>();
    for (int i = 1; i <= 25; i++) {
      ids.add("A" + i);
    }
    long firstChunkRow = seed(s[1], s[2], "A1");
    long secondChunkRow = seed(s[1], s[2], "A21");
    stubSinglePage(ids);
    java.util.concurrent.atomic.AtomicBoolean broken =
        new java.util.concurrent.atomic.AtomicBoolean(false);
    // 첫 묶음 permanentDelete 가 끝나면 그 뒤 토큰 조회는 「토큰을 읽지 못함」
    when(graphTokenService.getAccessToken(anyLong(), anyLong()))
        .thenAnswer(
            inv -> {
              if (broken.get()) {
                throw MailCredentialUnreadableException.oauthToken(null);
              }
              return TOKEN;
            });
    when(graphApiClient.batch(eq(TOKEN), any()))
        .thenAnswer(
            inv -> {
              List<GraphBatchRequest> reqs = inv.getArgument(1);
              if (isLocate(reqs)) {
                return reqs.stream()
                    .map(
                        r -> new GraphBatchResponse(r.id(), 200, locatedIn(TRASH_FOLDER_ID).body()))
                    .toList();
              }
              batches.add(reqs);
              broken.set(true);
              return reqs.stream().map(r -> new GraphBatchResponse(r.id(), 204)).toList();
            });

    MailTrashEmptyStatus st = trashService.startEmpty(s[0], s[1]);

    assertThat(pauses).isEmpty();
    assertThat(st.state()).isEqualTo("FAILED");
    assertThat(st.errorCode()).isEqualTo(MailTrashException.OAUTH_TOKEN_UNREADABLE);
    assertThat(st.error()).isEqualTo(MailServerErrors.OAUTH_TOKEN_UNREADABLE);
    assertThat(st.total()).isEqualTo(25);
    assertThat(st.deleted()).isEqualTo(20);
    assertThat(st.failed()).isEqualTo(5);
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(firstChunkRow))).isFalse();
    assertThat(dsl.fetchExists(EMAIL_MESSAGE, EMAIL_MESSAGE.ID.eq(secondChunkRow))).isTrue();
  }
}

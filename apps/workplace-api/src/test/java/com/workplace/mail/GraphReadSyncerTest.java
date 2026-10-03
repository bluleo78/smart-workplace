package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.service.GraphReadSyncer;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** WP-187 Graph 역동기화 — $batch 20건 단위, 항목별 상태, 429 에서 멈춤. WP-215: 토큰은 세션(open) 1회에 한 번. */
class GraphReadSyncerTest extends IntegrationTestBase {

  @Autowired GraphReadSyncer syncer;
  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

  /** 토큰 조회에 계정 id(10)만 쓰인다 — 나머지 필드는 Graph 처리기가 읽지 않는다. */
  private static final EmailAccountResponse ACCOUNT =
      new EmailAccountResponse(
          10L,
          "g@test.local",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          false,
          null,
          MailProvider.M365_GRAPH);

  private static SeenSyncItem item(long id, boolean seen) {
    return new SeenSyncItem(
        id, new ReadSyncLocator(10L, MailProvider.M365_GRAPH, "G" + id, null, "INBOX"), seen);
  }

  @SuppressWarnings("unchecked")
  @Test
  void patchesIsReadPerItem_withCurrentSeen() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    when(graphApiClient.batch(eq("T"), anyList()))
        .thenReturn(List.of(new GraphBatchResponse("1", 200), new GraphBatchResponse("2", 200)));

    SeenSyncResult r = syncer.open(1L, ACCOUNT).push(List.of(item(1, true), item(2, false)));

    ArgumentCaptor<List<GraphBatchRequest>> cap = ArgumentCaptor.forClass(List.class);
    verify(graphApiClient).batch(eq("T"), cap.capture());
    assertThat(cap.getValue())
        .extracting(GraphBatchRequest::url)
        .containsExactly("/me/messages/G1", "/me/messages/G2");
    assertThat(cap.getValue())
        .extracting(rq -> rq.body().get("isRead"))
        .containsExactly(true, false);
    assertThat(cap.getValue()).extracting(GraphBatchRequest::id).containsExactly("1", "2");
    assertThat(r.succeeded()).containsExactlyInAnyOrder(1L, 2L);
    assertThat(r.stopped()).isFalse();
  }

  @Test
  void splitsIntoBatchesOf20_andStopsAfter429() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    List<SeenSyncItem> items = IntStream.rangeClosed(1, 45).mapToObj(i -> item(i, true)).toList();
    // 첫 묶음: 1~19 성공, 20 은 429 → 그 묶음 처리 뒤 멈춤(두 번째 묶음 호출 없음)
    when(graphApiClient.batch(eq("T"), anyList()))
        .thenReturn(
            IntStream.rangeClosed(1, 20)
                .mapToObj(i -> new GraphBatchResponse(String.valueOf(i), i == 20 ? 429 : 200))
                .toList());

    SeenSyncResult r = syncer.open(1L, ACCOUNT).push(items);

    verify(graphApiClient, times(1)).batch(eq("T"), anyList());
    assertThat(r.succeeded()).hasSize(19).doesNotContain(20L);
    assertThat(r.stopped()).isTrue();
  }

  /** batch 요청 자체가 실패해도(최상위 429·네트워크) 앞 묶음의 성공분은 돌려주고 멈춘다 — 예외로 올려 이미 반영된 메일까지 대기로 남기지 않는다. */
  @SuppressWarnings("unchecked")
  @Test
  void wholeBatchFailure_keepsEarlierSuccesses_andStops() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    List<SeenSyncItem> items = IntStream.rangeClosed(1, 45).mapToObj(i -> item(i, true)).toList();
    when(graphApiClient.batch(eq("T"), anyList()))
        .thenAnswer(
            inv ->
                ((List<GraphBatchRequest>) inv.getArgument(1))
                    .stream().map(rq -> new GraphBatchResponse(rq.id(), 200)).toList())
        .thenThrow(new MailSendException("Graph 429"));

    SeenSyncResult r = syncer.open(1L, ACCOUNT).push(items);

    verify(graphApiClient, times(2)).batch(eq("T"), anyList());
    assertThat(r.succeeded()).hasSize(20);
    assertThat(r.stopped()).isTrue();
  }

  @SuppressWarnings("unchecked")
  @Test
  void allBatchesSent_whenNoThrottle() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    List<SeenSyncItem> items = IntStream.rangeClosed(1, 45).mapToObj(i -> item(i, true)).toList();
    // 묶음마다 요청 id 그대로 200 을 돌려준다
    when(graphApiClient.batch(eq("T"), anyList()))
        .thenAnswer(
            inv ->
                ((List<GraphBatchRequest>) inv.getArgument(1))
                    .stream().map(rq -> new GraphBatchResponse(rq.id(), 200)).toList());

    SeenSyncResult r = syncer.open(1L, ACCOUNT).push(items);

    verify(graphApiClient, times(3)).batch(eq("T"), anyList()); // 20 + 20 + 5
    assertThat(r.succeeded()).hasSize(45);
    assertThat(r.stopped()).isFalse();
  }

  @Test
  void notFound_countsAsDone_otherClientErrorNot() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    when(graphApiClient.batch(eq("T"), anyList()))
        .thenReturn(List.of(new GraphBatchResponse("1", 404), new GraphBatchResponse("2", 400)));

    SeenSyncResult r = syncer.open(1L, ACCOUNT).push(List.of(item(1, true), item(2, true)));

    assertThat(r.succeeded()).containsExactly(1L);
    assertThat(r.stopped()).isFalse();
  }

  @Test
  void localRowWithoutProviderId_countsAsDone_withoutCall() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    SeenSyncItem local =
        new SeenSyncItem(
            7L, new ReadSyncLocator(10L, MailProvider.M365_GRAPH, null, null, "SENT"), true);

    SeenSyncResult r = syncer.open(1L, ACCOUNT).push(List.of(local));

    assertThat(r.succeeded()).containsExactly(7L);
    assertThat(r.stopped()).isFalse();
    org.mockito.Mockito.verifyNoInteractions(graphApiClient);
  }

  /** WP-215: 한 세션으로 여러 조각을 보내도 토큰은 open 에서 한 번만 받는다. */
  @Test
  void sessionReusesToken_acrossPushes() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    when(graphApiClient.batch(eq("T"), anyList()))
        .thenReturn(List.of(new GraphBatchResponse("1", 200)))
        .thenReturn(List.of(new GraphBatchResponse("2", 200)));

    var session = syncer.open(1L, ACCOUNT);
    assertThat(session.push(List.of(item(1, true))).succeeded()).containsExactly(1L);
    assertThat(session.push(List.of(item(2, true))).succeeded()).containsExactly(2L);

    verify(graphTokenService, times(1)).getAccessToken(1L, 10L);
    verify(graphApiClient, times(2)).batch(eq("T"), anyList());
    // 갓 연 세션은 재사용 상한(TOKEN_REUSE) 안이라 다시 열 필요가 없다
    assertThat(session.stale()).isFalse();
  }
}

package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
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

/** WP-187 Graph 역동기화 — $batch 20건 단위, 항목별 상태, 429 에서 멈춤. */
class GraphReadSyncerTest extends IntegrationTestBase {

  @Autowired GraphReadSyncer syncer;
  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

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

    SeenSyncResult r = syncer.syncSeen(1L, null, List.of(item(1, true), item(2, false)));

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

    SeenSyncResult r = syncer.syncSeen(1L, null, items);

    verify(graphApiClient, times(1)).batch(eq("T"), anyList());
    assertThat(r.succeeded()).hasSize(19).doesNotContain(20L);
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

    SeenSyncResult r = syncer.syncSeen(1L, null, items);

    verify(graphApiClient, times(3)).batch(eq("T"), anyList()); // 20 + 20 + 5
    assertThat(r.succeeded()).hasSize(45);
    assertThat(r.stopped()).isFalse();
  }

  @Test
  void notFound_countsAsDone_otherClientErrorNot() throws Exception {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("T");
    when(graphApiClient.batch(eq("T"), anyList()))
        .thenReturn(List.of(new GraphBatchResponse("1", 404), new GraphBatchResponse("2", 400)));

    SeenSyncResult r = syncer.syncSeen(1L, null, List.of(item(1, true), item(2, true)));

    assertThat(r.succeeded()).containsExactly(1L);
    assertThat(r.stopped()).isFalse();
  }

  @Test
  void localRowWithoutProviderId_countsAsDone_withoutCall() throws Exception {
    SeenSyncItem local =
        new SeenSyncItem(
            7L, new ReadSyncLocator(10L, MailProvider.M365_GRAPH, null, null, "SENT"), true);

    SeenSyncResult r = syncer.syncSeen(1L, null, List.of(local));

    assertThat(r.succeeded()).containsExactly(7L);
    assertThat(r.stopped()).isFalse();
    org.mockito.Mockito.verifyNoInteractions(graphApiClient, graphTokenService);
  }
}

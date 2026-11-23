package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.agentruntime.screen.AgentScreenRoutes.Route;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * 중계가 공유 경로 저장소를 쓰는지 단위 검증(WP-1978) — 화면 수 상한·입력 중 판정이 다른 파드의 행까지 보고, 입력 끄기·닫기가 저장소에 반영되며, 임대 갱신에서
 * 행을 잃은 화면은 닫히고 갱신 실패는 타이머를 멈추지 않는지 본다. DB 없이 메모리 저장소({@link InMemoryAgentScreenRoutes})와 가짜 소켓을
 * 쓴다.
 */
class AgentScreenRelayRouteTest {

  private static final long TENANT = 1L;
  private static final long AGENT = 2L;
  private static final String OTHER_POD = "other-pod";

  private InMemoryAgentScreenRoutes routes;
  private AgentScreenService service;
  private AgentScreenRelay relay;

  @BeforeEach
  void setUp() {
    routes = spy(new InMemoryAgentScreenRoutes());
    service = mock(AgentScreenService.class);
    relay =
        new AgentScreenRelay(
            mock(RunnerSseRegistry.class),
            routes,
            new AgentScreenPod("127.0.0.1", 6060),
            new ObjectMapper());
    relay.setService(service);
    relay.stopTimerForTest();
  }

  @AfterEach
  void tearDown() {
    relay.shutdown();
  }

  /** 다른 파드가 주인인 같은 AI 의 행을 저장소에 넣는다. */
  private UUID otherPodRow() {
    UUID id = UUID.randomUUID();
    routes.reserve(
        new Route(id, TENANT, AGENT, 3L, 4L, OTHER_POD, "10.0.0.9:9090"),
        null,
        Duration.ofSeconds(30),
        AgentScreenService.MAX_SESSIONS_PER_AGENT);
    return id;
  }

  /** 이 파드에 자리를 잡은 화면 id. */
  private UUID reserveHere() {
    UUID id = UUID.randomUUID();
    assertThat(relay.reserve(id, TENANT, AGENT, 3L, 4L, Instant.now().plusSeconds(600), "hash"))
        .isTrue();
    return id;
  }

  private static WebSocketSession socket() {
    WebSocketSession s = mock(WebSocketSession.class);
    when(s.isOpen()).thenReturn(true);
    when(s.getId()).thenReturn(UUID.randomUUID().toString());
    return s;
  }

  /** 가짜 소켓이 받은 텍스트 프레임들. */
  private static List<String> textsSentTo(WebSocketSession s) throws Exception {
    @SuppressWarnings("unchecked")
    ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
    verify(s, atLeast(0)).sendMessage(captor.capture());
    return captor.getAllValues().stream()
        .filter(TextMessage.class::isInstance)
        .map(m -> ((TextMessage) m).getPayload())
        .toList();
  }

  private static TextMessage input(boolean enabled) {
    return new TextMessage("{\"type\":\"input\",\"enabled\":" + enabled + "}");
  }

  @Test
  void reserve_countsOtherPodRows() {
    otherPodRow();
    otherPodRow();
    otherPodRow();
    UUID id = UUID.randomUUID();

    assertThat(relay.reserve(id, TENANT, AGENT, 3L, 4L, Instant.now().plusSeconds(600), "h"))
        .isFalse();
    assertThat(relay.pairOf(id)).isNull();
  }

  @Test
  void inputTakenByOtherPod_rejectsClaim() throws Exception {
    UUID other = otherPodRow();
    assertThat(routes.claimInput(other, TENANT, AGENT)).isTrue();
    UUID id = reserveHere();
    WebSocketSession browser = socket();
    WebSocketSession runner = socket();
    relay.attachBrowser(id, browser, false);
    relay.attachRunner(id, runner, false);

    relay.fromRunner(id, input(true));

    assertThat(relay.pairOf(id).inputEnabled).isFalse();
    assertThat(textsSentTo(runner)).anyMatch(t -> t.contains("\"enabled\":false"));
    List<String> toBrowser = textsSentTo(browser);
    assertThat(toBrowser).anyMatch(t -> t.contains(AgentScreenRelay.INPUT_TAKEN));
    assertThat(toBrowser).noneMatch(t -> t.contains("\"enabled\":true"));
    verify(service, never()).recordInputEnabled(anyLong(), any(), anyLong(), anyLong());
  }

  /**
   * 입력 중 확인(DB)이 던지면 입력을 열지 않는다 — 플래그는 꺼진 채, runner 에 끄기, 브라우저에 오류, 켜짐 프레임은 브라우저로 넘기지 않는다(닫힌 쪽 실패).
   */
  @Test
  void inputTakenCheckThrows_keepsInputClosed() throws Exception {
    UUID id = reserveHere();
    WebSocketSession browser = socket();
    WebSocketSession runner = socket();
    relay.attachBrowser(id, browser, false);
    relay.attachRunner(id, runner, false);
    doThrow(new RuntimeException("db down"))
        .when(routes)
        .inputTakenByOther(any(), anyLong(), anyLong());

    relay.fromRunner(id, input(true));

    assertInputRejected(id, browser, runner);
  }

  /** 입력 중 표시(DB)가 던지면 입력을 열지 않는다 — 확인을 지나 기록까지 한 뒤의 마지막 단계 실패도 닫힌 쪽으로. */
  @Test
  void claimInputThrows_keepsInputClosed() throws Exception {
    UUID id = reserveHere();
    WebSocketSession browser = socket();
    WebSocketSession runner = socket();
    relay.attachBrowser(id, browser, false);
    relay.attachRunner(id, runner, false);
    doThrow(new RuntimeException("db down")).when(routes).claimInput(any(), anyLong(), anyLong());

    relay.fromRunner(id, input(true));

    assertInputRejected(id, browser, runner);
  }

  /** 입력 거절의 공통 결과 — 플래그 꺼짐, runner 에 끄기, 브라우저에 확인 실패 오류, 켜짐 프레임은 넘기지 않음. */
  private void assertInputRejected(UUID id, WebSocketSession browser, WebSocketSession runner)
      throws Exception {
    assertThat(relay.pairOf(id).inputEnabled).isFalse();
    assertThat(textsSentTo(runner))
        .anyMatch(t -> t.contains("\"type\":\"input\"") && t.contains("\"enabled\":false"));
    List<String> toBrowser = textsSentTo(browser);
    assertThat(toBrowser)
        .anyMatch(
            t ->
                t.contains("\"type\":\"error\"")
                    && t.contains(AgentScreenRelay.INPUT_CHECK_FAILED));
    assertThat(toBrowser).noneMatch(t -> t.contains("\"enabled\":true"));
  }

  @Test
  void inputOff_releasesHolder() {
    UUID id = reserveHere();
    relay.attachBrowser(id, socket(), false);
    relay.attachRunner(id, socket(), false);
    UUID probe = UUID.randomUUID();

    relay.fromRunner(id, input(true));
    assertThat(relay.pairOf(id).inputEnabled).isTrue();
    assertThat(routes.inputTakenByOther(probe, TENANT, AGENT)).isTrue();

    relay.fromBrowserText(id, input(false));

    assertThat(relay.pairOf(id).inputEnabled).isFalse();
    assertThat(routes.inputTakenByOther(probe, TENANT, AGENT)).isFalse();
  }

  @Test
  void runnerInputOff_releasesHolder() {
    UUID id = reserveHere();
    relay.attachBrowser(id, socket(), false);
    relay.attachRunner(id, socket(), false);
    UUID probe = UUID.randomUUID();
    relay.fromRunner(id, input(true));

    relay.fromRunner(id, input(false));

    assertThat(relay.pairOf(id).inputEnabled).isFalse();
    assertThat(routes.inputTakenByOther(probe, TENANT, AGENT)).isFalse();
  }

  @Test
  void close_removesRoute() {
    UUID id = reserveHere();
    assertThat(routes.find(id)).isPresent();

    relay.close(relay.pairOf(id), "t", false);

    assertThat(routes.find(id)).isEmpty();
  }

  @Test
  void release_removesRoute() {
    UUID id = reserveHere();

    relay.release(id);

    assertThat(relay.pairOf(id)).isNull();
    assertThat(routes.find(id)).isEmpty();
  }

  @Test
  void renew_missingRow_closesSession() throws Exception {
    UUID id = reserveHere();
    WebSocketSession browser = socket();
    relay.attachBrowser(id, browser, false);
    AgentScreenRelay.Pair p = relay.pairOf(id);
    routes.remove(id);

    relay.renew();

    assertThat(p.closed.get()).isTrue();
    assertThat(relay.pairOf(id)).isNull();
    assertThat(textsSentTo(browser))
        .anyMatch(t -> t.contains("\"ended\"") && t.contains(AgentScreenRelay.REASON_ROUTE_LOST));
  }

  @Test
  void renew_extendsLiveRowsOfThisPod() {
    UUID id = reserveHere();

    relay.renew();

    verify(routes).renew(anyString(), anyCollection());
    assertThat(relay.pairOf(id).closed.get()).isFalse();
  }

  @Test
  void renew_failure_keepsTimer() {
    UUID id = reserveHere();
    doThrow(new RuntimeException("db down")).when(routes).renew(anyString(), anyCollection());

    assertThatCode(relay::renew).doesNotThrowAnyException();

    assertThat(relay.pairOf(id)).isNotNull();
    assertThat(relay.pairOf(id).closed.get()).isFalse();
  }

  /** 메모리 저장소도 행이 없으면 입력을 쥐지 못한다(Jooq 구현과 같은 계약 — WP-1978 리뷰). */
  @Test
  void inMemoryClaimInput_missingRow_returnsFalse() {
    assertThat(new InMemoryAgentScreenRoutes().claimInput(UUID.randomUUID(), TENANT, AGENT))
        .isFalse();
  }

  @Test
  void isOwner_comparesPodId() {
    UUID id = reserveHere();
    assertThat(relay.isOwner(routes.find(id).orElseThrow())).isTrue();
    UUID other = otherPodRow();
    assertThat(relay.isOwner(routes.find(other).orElseThrow())).isFalse();
  }
}

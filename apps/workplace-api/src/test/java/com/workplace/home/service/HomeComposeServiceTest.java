package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.outbound.AiAgentComposeClient;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * HomeComposeService 통합 테스트 — SSE 패스스루 + done 영속 검증.
 *
 * <p>AiAgentComposeClient 는 Mockito bean 으로 대체해 실제 ai-agent 없이 테스트한다. composeStream 은 비동기 펌프를 제출하므로
 * CountDownLatch 로 done 완료를 기다린다. @Transactional 을 쓰지 않는다 — 펌프 스레드의 ASSISTANT appendMessage 가 별도 tx
 * 로 커밋되어야 하기 때문이다.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeComposeServiceTest extends IntegrationTestBase {

  @Autowired HomeComposeService composeService;
  @Autowired HomeSessionService sessionService;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @MockitoBean AiAgentComposeClient composeClient;
  @MockitoBean AssistantResolver assistantResolver;

  private void stubAssistant() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

  private long user(String n) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, n)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, n)
        .set(USER.EMAIL, n + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private JsonNode widgets(String json) throws Exception {
    return objectMapper.readTree(json);
  }

  /**
   * delta×2 + done 시퀀스를 시뮬레이션한다. composeClient.composeStream 을 가로채 onDelta 를 2회, onDone 을 1회 즉시
   * 호출한다. CountDownLatch 로 펌프 완료를 기다린 뒤 세션 메시지를 조회해 USER/ASSISTANT 영속을 검증한다.
   */
  @Test
  void sessionId_null_이면_새_세션_생성하고_USER_ASSISTANT_영속() throws Exception {
    long uid = user("compose" + System.nanoTime());
    stubAssistant();

    // composeStream 은 void 반환 → doAnswer 사용. delta×2 + done 즉시 호출.
    CountDownLatch doneLatch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              java.util.function.Consumer<String> onDelta = inv.getArgument(1);
              java.util.function.BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDelta.accept("내 ");
              onDelta.accept("할 일이에요");
              onDone.accept("내 할 일이에요", widgets("[{\"type\":\"my_tasks\",\"params\":{}}]"));
              doneLatch.countDown();
              return null;
            })
        .when(composeClient)
        .composeStream(any(), any(), any(), any(), any(), any());

    SseEmitter emitter = composeService.composeStream(uid, null, "내 할 일");
    assertThat(emitter).isNotNull();

    // 펌프 완료 대기(최대 5초).
    assertThat(doneLatch.await(5, TimeUnit.SECONDS)).isTrue();

    // 세션 목록 조회 후 메시지 검증.
    List<HomeSessionSummary> summaries = sessionService.list(uid, null, 10).items();
    assertThat(summaries).hasSize(1);
    UUID sid = summaries.get(0).id();

    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, sid);
    assertThat(msgs).hasSize(2);
    assertThat(msgs.get(0).role()).isEqualTo("USER");
    assertThat(msgs.get(0).content()).isEqualTo("내 할 일");
    assertThat(msgs.get(1).role()).isEqualTo("ASSISTANT");
    assertThat(msgs.get(1).content()).isEqualTo("내 할 일이에요");
    assertThat(msgs.get(1).widgets().get(0).get("type").asText()).isEqualTo("my_tasks");
  }

  /** 기존 세션의 최근 메시지를 recentContext 로 전달하는지 검증. */
  @Test
  void 기존_세션의_최근메시지를_recentContext_로_전달_현재query_제외() throws Exception {
    long uid = user("ctx" + System.nanoTime());
    var s = sessionService.create(uid);
    // 사전 대화 1턴 적재.
    sessionService.appendMessage(uid, s.id(), "USER", "내 담당 보여줘", null);
    sessionService.appendMessage(
        uid,
        s.id(),
        "ASSISTANT",
        "내 담당이에요",
        "[{\"type\":\"issue_list\",\"params\":{\"assignee\":\"me\"}}]");
    stubAssistant();

    CountDownLatch doneLatch = new CountDownLatch(1);
    doAnswer(
            inv -> {
              java.util.function.BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("HIGH 만 추렸어요", null);
              doneLatch.countDown();
              return null;
            })
        .when(composeClient)
        .composeStream(any(), any(), any(), any(), any(), any());

    composeService.composeStream(uid, s.id(), "그 중 HIGH 만");
    assertThat(doneLatch.await(5, TimeUnit.SECONDS)).isTrue();

    ArgumentCaptor<ComposeRequest> captor = ArgumentCaptor.forClass(ComposeRequest.class);
    verify(composeClient).composeStream(captor.capture(), any(), any(), any(), any(), any());
    ComposeRequest sent = captor.getValue();
    assertThat(sent.query()).isEqualTo("그 중 HIGH 만");
    // recentContext: 직전 2개(USER/ASSISTANT) 텍스트만, 현재 query 는 미포함.
    assertThat(sent.recentContext()).extracting("content").containsExactly("내 담당 보여줘", "내 담당이에요");
  }
}

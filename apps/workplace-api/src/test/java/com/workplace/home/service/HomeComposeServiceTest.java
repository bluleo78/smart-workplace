package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.outbound.AiAgentComposeClient;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

// enabled=true 로 ai-agent 연동 켜고, 실 client 는 mock 으로 대체.
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeComposeServiceTest extends IntegrationTestBase {

  @Autowired HomeComposeService composeService;
  @Autowired HomeSessionService sessionService;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @MockitoBean AiAgentComposeClient composeClient;
  // 비서 해석은 본 테스트 관심사 밖 — 더미 사양으로 고정해 resolve 가 503 으로 단락되지 않게 한다.
  @MockitoBean AssistantResolver assistantResolver;

  private void stubAssistant() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
  }

  // 7a HomeSessionServiceTest 의 user(String) 헬퍼와 동일.
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

  @Test
  void sessionId_null_이면_새_세션_생성하고_USER_ASSISTANT_영속() throws Exception {
    long uid = user("compose" + System.nanoTime());
    stubAssistant();
    when(composeClient.compose(any()))
        .thenReturn(
            new ComposeResult("내 할 일이에요", widgets("[{\"type\":\"my_tasks\",\"params\":{}}]")));

    HomeComposeResponse res = composeService.compose(uid, null, "내 할 일");

    assertThat(res.sessionId()).isNotNull();
    assertThat(res.message()).isEqualTo("내 할 일이에요");
    assertThat(res.widgets().get(0).get("type").asText()).isEqualTo("my_tasks");

    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, res.sessionId());
    assertThat(msgs).hasSize(2);
    assertThat(msgs.get(0).role()).isEqualTo("USER");
    assertThat(msgs.get(0).content()).isEqualTo("내 할 일");
    assertThat(msgs.get(1).role()).isEqualTo("ASSISTANT");
    assertThat(msgs.get(1).widgets().get(0).get("type").asText()).isEqualTo("my_tasks");
  }

  @Test
  void 기존_세션의_최근메시지를_recentContext_로_전달_현재query_제외() throws Exception {
    long uid = user("ctx" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(uid);
    // 사전 대화 1턴 적재.
    sessionService.appendMessage(uid, s.id(), "USER", "내 담당 보여줘", null);
    sessionService.appendMessage(
        uid,
        s.id(),
        "ASSISTANT",
        "내 담당이에요",
        "[{\"type\":\"issue_list\",\"params\":{\"assignee\":\"me\"}}]");
    stubAssistant();
    when(composeClient.compose(any())).thenReturn(new ComposeResult("HIGH 만 추렸어요", widgets("[]")));

    composeService.compose(uid, s.id(), "그 중 HIGH 만");

    ArgumentCaptor<ComposeRequest> captor = ArgumentCaptor.forClass(ComposeRequest.class);
    verify(composeClient).compose(captor.capture());
    ComposeRequest sent = captor.getValue();
    assertThat(sent.query()).isEqualTo("그 중 HIGH 만");
    // recentContext: 직전 2개(USER/ASSISTANT) 텍스트만, 현재 query 는 미포함.
    assertThat(sent.recentContext()).extracting("content").containsExactly("내 담당 보여줘", "내 담당이에요");
  }
}

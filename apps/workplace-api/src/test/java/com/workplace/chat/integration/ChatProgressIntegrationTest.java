package com.workplace.chat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.support.IntegrationTestBase;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * AI 진행(progress) SSE fan-out 통합 테스트.
 *
 * <p>ai-agent 가 {@code Authorization: Internal {token}} + {@code X-On-Behalf-Of: {agentId}} 로
 * progress 를 POST 하면, api 가 thread 전 멤버에게 {@code chat.message.progress} 이벤트를 fan-out 함을 검증한다. SSE
 * 수신은 {@link ChatSseFanOutTest} 와 동일하게 {@link SseRegistry} 를 mock 으로 가로채 fanOut 호출을 단언한다(실 스트림 소비
 * 대신).
 */
@AutoConfigureMockMvc
class ChatProgressIntegrationTest extends IntegrationTestBase {

  /** 운영 application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단
  @Autowired MockMvc mockMvc;
  @Autowired ChatThreadService threadService;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ChatFixtures fx;

  // 비-Tx 통합테스트: 커밋된 fixture 데이터를 회수.
  @AfterEach
  void cleanup() {
    fx.cleanupAll();
  }

  @Test
  void progressPost_byAgent_fansOutToThreadMembers() throws Exception {
    // given: 멤버(reporter=human)와 AGENT 가 함께 있는 thread.
    ChatFixtures.AgentSetup as = fx.setupWithAgent();
    long reporterId = as.base().reporterId();
    long agentId = as.agentId();
    var thread =
        threadService.getOrCreate(reporterId, as.base().projectKey(), as.base().issueNumber());
    long threadId = thread.threadId();
    // notifyProgress 의 ensureMember 통과를 위해 AGENT 를 thread 멤버로 등록.
    memberRepo.insertIgnoreConflict(threadId, List.of(agentId));

    // when: ai-agent 가 Internal + X-On-Behalf-Of=agentId 로 progress POST.
    String body =
        "{\"streamId\":\"s1\",\"phase\":\"tool\","
            + "\"steps\":[{\"label\":\"위키 검색\",\"status\":\"running\"}]}";
    mockMvc
        .perform(
            post("/api/v1/chat/threads/{id}/progress", threadId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(agentId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isNoContent());

    // then: chat.message.progress 가 thread 전 멤버에게 fan-out 되고, payload 에 streamId/threadId 포함.
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry, timeout(2000))
        .fanOut(ids.capture(), eq("chat.message.progress"), payload.capture());
    assertThat(ids.getValue()).contains(reporterId);
    assertThat(payload.getValue()).containsEntry("streamId", "s1");
    assertThat(payload.getValue()).containsEntry("threadId", threadId);
  }
}

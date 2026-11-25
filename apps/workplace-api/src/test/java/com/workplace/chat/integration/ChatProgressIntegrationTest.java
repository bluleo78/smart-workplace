package com.workplace.chat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.dto.AiProgressRequest;
import com.workplace.global.dto.AiProgressStep;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * AI 진행(progress) SSE fan-out 통합 테스트.
 *
 * <p>ai-agent 가 {@code Authorization: Internal {token}} + {@code X-On-Behalf-Of: {agentId}} 로
 * progress 를 POST 하면, api 가 thread 전 멤버에게 {@code chat.message.progress} 이벤트를 fan-out 함을 검증한다. SSE
 * 수신은 {@link ChatSseFanOutTest} 와 동일하게 {@link SseRegistry} 를 mock 으로 가로채 fanOut 호출을 단언한다(실 스트림 소비
 * 대신).
 */
class ChatProgressIntegrationTest extends ExternalClientMockedTestBase {

  /** 운영 application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  /** 금지 경로 테스트의 장벽 진행 streamId(WP-2127) — never() 매처가 이 streamId 만 빼고 본다. */
  private static final String BARRIER_STREAM_ID = "barrier-c3";

  @Autowired SseRegistry registry;
  @Autowired AiAgentEventClient aiClient; // ai-agent 실제 호출 차단
  @Autowired MockMvc mockMvc;
  @Autowired ChatThreadService threadService;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ChatFixtures fx;
  @Autowired JwtTokenProvider jwtTokenProvider;

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
    postAgentProgress(threadId, agentId, body).andExpect(status().isNoContent());

    // then: chat.message.progress 가 thread 전 멤버에게 fan-out 되고, payload 에 streamId/threadId 포함.
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    // WP-2117: 공유 mock registry 에 다른 테스트의 늦은 fan-out 이 섞일 수 있어,
    // payload 를 이 테스트의 streamId·threadId 로 좁힌 호출만 잡는다(안 좁히면 getValue() 가 엉뚱한 호출을 집는다).
    // 매처가 payload 의 streamId/threadId 단언을 겸한다.
    verify(registry, timeout(2000))
        .fanOut(
            ids.capture(),
            eq("chat.message.progress"),
            argThat(
                (Map<String, Object> p) ->
                    p != null && "s1".equals(p.get("streamId")) && onThread(p, threadId)));
    assertThat(ids.getValue()).contains(reporterId);
  }

  @Test
  void progressPost_byHumanMemberJwt_isForbiddenAndNotFannedOut() throws Exception {
    // WP-1191: 이슈 채팅도 사람 멤버가 자기 토큰으로 가짜 「AI 작업 중」 말풍선을 띄울 수 있었다 — 내부 대행 호출만 받는다.
    ChatFixtures.AgentSetup as = fx.setupWithAgent();
    long reporterId = as.base().reporterId();
    long threadId =
        threadService
            .getOrCreate(reporterId, as.base().projectKey(), as.base().issueNumber())
            .threadId();
    String token =
        jwtTokenProvider.generateAccessToken(
            reporterId, "reporter-" + reporterId, defaultTenantId());
    mockMvc
        .perform(
            post("/api/v1/chat/threads/{id}/progress", threadId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"streamId\":\"fake-c3\","
                        + "\"steps\":[{\"label\":\"이 이슈를 삭제하는 중…\",\"status\":\"running\"}]}"))
        .andExpect(status().isForbidden())
        // 멤버십·필터가 아니라 내부 호출 확인에서 막혔다
        .andExpect(jsonPath("$.message").value(AiProgressRequest.INTERNAL_ONLY_MESSAGE));
    // WP-2127: 장벽 — 금지 POST 뒤 같은 스레드에 정상(AGENT 대행) 진행 POST 를 보내 그 fan-out 을 기다린다.
    // 지금은 금지 POST 가 이벤트를 내기 전에 403 으로 막히고 onProgress 도 동기 fan-out 이라 장벽은 바로 지나간다(대기 0) —
    // 나중에 금지 경로가 새거나 fan-out 이 비동기가 될 때를 지키는 장치다. 한 줄로 차례대로 도는 비동기(단일 스레드 큐)면 앞선 금지 이벤트를 먼저 처리한 뒤
    // 장벽을 내므로, 아래 never() 가 응답 직후 한 번만 보다가 늦게 새는 이벤트를 놓치는 일을 줄인다.
    // 한계: 차례를 지키지 않는 다중 스레드 비동기에서 장벽보다 늦게 도착하는 누출은 여전히 못 잡는다.
    long agentId = as.agentId();
    memberRepo.insertIgnoreConflict(threadId, List.of(agentId));
    postAgentProgress(
            threadId,
            agentId,
            "{\"streamId\":\""
                + BARRIER_STREAM_ID
                + "\",\"steps\":[{\"label\":\"장벽\",\"status\":\"running\"}]}")
        .andExpect(status().isNoContent());
    verify(registry, timeout(2000))
        .fanOut(
            any(),
            eq("chat.message.progress"),
            argThat(
                (Map<String, Object> p) ->
                    p != null
                        && BARRIER_STREAM_ID.equals(p.get("streamId"))
                        && onThread(p, threadId)));
    // WP-2117: 다른 테스트의 progress fan-out 에 거짓으로 깨지지 않게 이 테스트의 것만 본다 — 가짜 streamId 이거나
    // 이 테스트 스레드(threadId)로 간 장벽이 아닌 progress 면 새어 나간 것이다(streamId 가 바뀌어 나가도 잡게).
    verify(registry, never())
        .fanOut(
            any(),
            eq("chat.message.progress"),
            argThat(
                (Map<String, Object> p) ->
                    p != null
                        && ("fake-c3".equals(p.get("streamId"))
                            || (onThread(p, threadId)
                                && !BARRIER_STREAM_ID.equals(p.get("streamId"))))));
  }

  @Test
  void progressPost_overStepLimit_isBadRequest() throws Exception {
    // WP-1191: 이슈 채팅도 채널과 같은 요청 본문(AiProgressRequest)을 @Valid 로 받는다 — 상한 검사는 메서드 본문(멤버 확인) 전에 걸리므로
    // 스레드·멤버 준비 없이 본다. 상한 경계·값 검사는 MessagingProgressIntegrationTest 가 지킨다.
    long agentId = fx.setupWithAgent().agentId();
    postAgentProgress(
            1L,
            agentId,
            "{\"streamId\":\"s1\",\"steps\":["
                + String.join(
                    ",",
                    Collections.nCopies(
                        AiProgressStep.MAX_STEPS + 1, "{\"label\":\"위키 검색\",\"status\":\"done\"}"))
                + "]}")
        .andExpect(status().isBadRequest());
  }

  /** ai-agent 처럼 Internal 토큰 + X-On-Behalf-Of(agentId)로 진행 POST 를 보낸다 — 응답 단언은 부른 쪽 몫. */
  private ResultActions postAgentProgress(long threadId, long agentId, String body)
      throws Exception {
    return mockMvc.perform(
        post("/api/v1/chat/threads/{id}/progress", threadId)
            .header("Authorization", "Internal " + INTERNAL_TOKEN)
            .header("X-On-Behalf-Of", String.valueOf(agentId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  /**
   * payload 가 이 스레드로 간 진행인가 — threadId 는 문자열로 견준다(숫자 타입 Long/Integer 가 바뀌어도 조용히 놓치지 않게, WP-2117).
   */
  private static boolean onThread(Map<String, Object> p, long threadId) {
    return String.valueOf(threadId).equals(String.valueOf(p.get("threadId")));
  }
}

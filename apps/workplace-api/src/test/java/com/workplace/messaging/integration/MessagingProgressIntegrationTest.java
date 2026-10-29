package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.dto.AiProgressRequest;
import com.workplace.global.dto.AiProgressStep;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * AI 진행(progress) SSE fan-out 메시징 통합 테스트.
 *
 * <p>ai-agent 가 {@code Authorization: Internal {token}} + {@code X-On-Behalf-Of: {agentId}} 로
 * progress 를 POST 하면, api 가 채널 전 멤버에게 {@code messaging.message.progress} 이벤트를 fan-out 함을 검증한다. SSE
 * 수신은 {@link SseRegistry} 를 mock 으로 가로채어 fanOut 호출을 단언한다(실 스트림 소비 대신).
 */
class MessagingProgressIntegrationTest extends ExternalClientMockedTestBase {

  /** 운영 application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired SseRegistry registry;
  @Autowired MockMvc mockMvc;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository channelMemberRepo;
  @Autowired JwtTokenProvider jwtTokenProvider;

  // 비-Tx 통합 테스트: 만든 user id 추적 → @AfterEach 에서 채널(CASCADE)+user 회수.
  private final List<Long> createdUserIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (createdUserIds.isEmpty()) return;
    baseDsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(createdUserIds)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  /** 테스트 격리를 위해 UUID suffix 로 유니크 HUMAN 유저를 직접 INSERT 후 ID 반환. */
  private long seedHumanUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "msg_prog_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "MsgProg" + suffix)
            .set(USER.EMAIL, "msg_prog_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  @Test
  void progressPost_byAgent_fansOutToChannelMembers() throws Exception {
    // given: 채널에 HUMAN 멤버와 AGENT 가 함께 있다.
    long[] c = channelWithHumanAndAgent();
    long channelId = c[0];
    long humanId = c[1];

    // when: ai-agent 가 Internal + X-On-Behalf-Of=agentId 로 progress POST.
    postAsAgent(channelId, c[2], progressBody(1)).andExpect(status().isNoContent());

    // then: messaging.message.progress 가 채널 전 멤버에게 fan-out 되고, payload 에 streamId/channelId 포함.
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry, timeout(2000))
        .fanOut(ids.capture(), eq("messaging.message.progress"), payload.capture());
    assertThat(ids.getValue()).contains(humanId);
    assertThat(payload.getValue()).containsEntry("streamId", "s1");
    assertThat(payload.getValue()).containsEntry("channelId", channelId);
  }

  /** 사람 멤버·AGENT 가 함께 있는 채널을 만들고 [channelId, humanId, agentId] 를 돌려준다. */
  private long[] channelWithHumanAndAgent() {
    long humanId = seedHumanUser();
    long agentId = createAgentUser("msg-progress-agent");
    createdUserIds.add(agentId);
    long channelId = channelRepo.insertPublic("progress-test-" + UUID.randomUUID(), humanId);
    channelMemberRepo.join(channelId, humanId);
    channelMemberRepo.join(channelId, agentId);
    return new long[] {channelId, humanId, agentId};
  }

  /** 「위키 검색 · done」 단계 n 개를 담은 progress 본문. */
  private static String progressBody(int n) {
    String step = "{\"label\":\"위키 검색\",\"status\":\"done\"}";
    return "{\"streamId\":\"s1\",\"phase\":\"tool\",\"steps\":["
        + String.join(",", Collections.nCopies(n, step))
        + "]}";
  }

  /** ai-agent 대행 호출(Internal + X-On-Behalf-Of)로 progress 를 보낸다. */
  private ResultActions postAsAgent(long channelId, long agentId, String body) throws Exception {
    return mockMvc.perform(
        post("/api/v1/messaging/channels/{id}/progress", channelId)
            .header("Authorization", "Internal " + INTERNAL_TOKEN)
            .header("X-On-Behalf-Of", String.valueOf(agentId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  @Test
  void progressPost_byHumanMemberJwt_isForbiddenAndNotFannedOut() throws Exception {
    // WP-1191: 사람 멤버가 자기 토큰으로 부르면 다른 멤버 화면에 가짜 「AI 작업 중」 말풍선이 떴다 — 내부 대행 호출만 받는다.
    long[] c = channelWithHumanAndAgent();
    withMembership(c[1]); // JWT 필터가 워크스페이스 구성원인지 본다 — 직접 넣은 사용자는 구성원 행이 없다
    String token = jwtTokenProvider.generateAccessToken(c[1], "human-" + c[1], defaultTenantId());
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/{id}/progress", c[0])
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"streamId\":\"fake-1\",\"phase\":\"tool\","
                        + "\"steps\":[{\"label\":\"외부로 전송 완료\",\"status\":\"done\"}]}"))
        .andExpect(status().isForbidden())
        // 멤버십·필터가 아니라 내부 호출 확인에서 막혔다
        .andExpect(jsonPath("$.message").value(AiProgressRequest.INTERNAL_ONLY_MESSAGE));
    verify(registry, never()).fanOut(any(), eq("messaging.message.progress"), any());
  }

  @Test
  void progressPost_overStepAndLabelLimits_isBadRequest() throws Exception {
    // WP-1191: 저장 없이 멤버 전원 SSE 로 나가므로 단계 수(100)·문구 길이(200자)를 묶는다.
    long[] c = channelWithHumanAndAgent();
    postAsAgent(c[0], c[2], progressBody(AiProgressStep.MAX_STEPS + 1))
        .andExpect(status().isBadRequest());
    String longLabel =
        "{\"streamId\":\"s1\",\"steps\":[{\"label\":\""
            + "가".repeat(AiProgressStep.MAX_LABEL + 1)
            + "\",\"status\":\"done\"}]}";
    postAsAgent(c[0], c[2], longLabel).andExpect(status().isBadRequest());
    // 경계: 상한 개수·상한 길이는 받는다
    postAsAgent(c[0], c[2], progressBody(AiProgressStep.MAX_STEPS))
        .andExpect(status().isNoContent());
    postAsAgent(
            c[0],
            c[2],
            longLabel.replace(
                "가".repeat(AiProgressStep.MAX_LABEL + 1), "가".repeat(AiProgressStep.MAX_LABEL)))
        .andExpect(status().isNoContent());
    // 값: 빈 단계·웹이 그리지 않는 상태·phase 는 거절
    postAsAgent(c[0], c[2], "{\"streamId\":\"s1\",\"steps\":[null]}")
        .andExpect(status().isBadRequest());
    postAsAgent(
            c[0],
            c[2],
            "{\"streamId\":\"s1\",\"steps\":[{\"label\":\"위키 검색\",\"status\":\"hacked\"}]}")
        .andExpect(status().isBadRequest());
    postAsAgent(c[0], c[2], "{\"streamId\":\"s1\",\"phase\":\"exporting\",\"steps\":[]}")
        .andExpect(status().isBadRequest());
  }
}

package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * AI 진행(progress) SSE fan-out 메시징 통합 테스트.
 *
 * <p>ai-agent 가 {@code Authorization: Internal {token}} + {@code X-On-Behalf-Of: {agentId}} 로
 * progress 를 POST 하면, api 가 채널 전 멤버에게 {@code messaging.message.progress} 이벤트를 fan-out 함을 검증한다. SSE
 * 수신은 {@link SseRegistry} 를 mock 으로 가로채어 fanOut 호출을 단언한다(실 스트림 소비 대신).
 */
@AutoConfigureMockMvc
class MessagingProgressIntegrationTest extends IntegrationTestBase {

  /** 운영 application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @MockitoBean SseRegistry registry;
  @Autowired MockMvc mockMvc;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository channelMemberRepo;

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
    // given: 채널에 HUMAN 멤버와 AGENT 가 함께 있는 상태 설정.
    long humanId = seedHumanUser();
    // AGENT 유저 생성 (IntegrationTestBase 공용 helper 사용).
    long agentId = createAgentUser("msg-progress-agent");
    createdUserIds.add(agentId);

    // 퍼블릭 채널 생성 후 두 멤버 가입.
    long channelId = channelRepo.insertPublic("progress-test-" + UUID.randomUUID(), humanId);
    // notifyProgress 의 ensureMember 통과를 위해 두 유저 모두 채널 멤버로 등록.
    channelMemberRepo.join(channelId, humanId);
    channelMemberRepo.join(channelId, agentId);

    // when: ai-agent 가 Internal + X-On-Behalf-Of=agentId 로 progress POST.
    String body =
        "{\"streamId\":\"s1\",\"phase\":\"tool\","
            + "\"steps\":[{\"label\":\"위키 검색\",\"status\":\"running\"}]}";
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/{id}/progress", channelId)
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(agentId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isNoContent());

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
}

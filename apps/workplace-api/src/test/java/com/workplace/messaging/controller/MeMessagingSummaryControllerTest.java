package com.workplace.messaging.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * GET /api/v1/me/messaging-summary 통합 테스트.
 *
 * <p>실 JWT + MockMvc 로 전체 보안 체인을 통과시켜 대화 요약 API 를 검증한다. MeMailSummaryControllerTest 패턴 미러.
 */
@AutoConfigureMockMvc
@Transactional
class MeMessagingSummaryControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  @Test
  void summary_returnsRecentConversationsForCaller() throws Exception {
    // 시드: caller + other 유저, 공개 채널, 메시지 1건
    long caller = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long ch = channelRepo.insertPublic("요약테스트채널", other);
    channelService.join(other, ch);
    channelService.join(caller, ch);
    messageService.create(other, ch, new CreateMessageRequest("안녕하세요"));

    String token = jwtTokenProvider.generateAccessToken(caller, "user-" + caller);

    mvc.perform(get("/api/v1/me/messaging-summary").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.recent").isArray())
        .andExpect(jsonPath("$.needsReplyCount").exists())
        .andExpect(jsonPath("$.unreadConversationCount").exists())
        .andExpect(jsonPath("$.recent[0].label").value("요약테스트채널"));
  }
}

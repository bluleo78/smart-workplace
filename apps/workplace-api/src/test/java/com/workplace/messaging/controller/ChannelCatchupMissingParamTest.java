package com.workplace.messaging.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 필수 쿼리 파라미터가 빠진 요청은 500 이 아니라 400 이어야 한다(WP-494). 예전엔 전역 예외 처리에 {@code
 * MissingServletRequestParameterException} 매핑이 없어 Exception 폴백(500)으로 떨어졌다 — 채널 캐치업의 since 가 대표 사례.
 */
@Transactional
class ChannelCatchupMissingParamTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;

  @Test
  void catchup_without_since_returns_400_naming_the_param() throws Exception {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "cu-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "cu")
            .set(USER.EMAIL, "cu-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    TestFixtures.activeMemberOfCurrentTenant(dsl, userId);
    long channelId = channelRepo.insertPublic("캐치업-" + suffix, userId);
    channelService.join(userId, channelId);

    mvc.perform(
            get("/api/v1/messaging/channels/" + channelId + "/catchup")
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.since").exists());
  }
}

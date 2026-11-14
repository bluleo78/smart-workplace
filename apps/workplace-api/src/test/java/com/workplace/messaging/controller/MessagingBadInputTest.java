package com.workplace.messaging.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-512: 팀 채팅 API 에 잘못된 입력을 보내면 500 이나 내부 예외 원문이 아니라 400 과 한국어 안내로 응답한다 — 첨부 업로드의 files 파트 누락, 메시지
 * 목록의 깨진 cursor. limit 는 1~100 으로 맞춘다.
 */
@Transactional
class MessagingBadInputTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;

  private long userId;
  private long channelId;
  private String auth;

  @BeforeEach
  void setUp() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "bi-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "bi")
            .set(USER.EMAIL, "bi-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    TestFixtures.activeMemberOfCurrentTenant(dsl, userId);
    channelId = channelRepo.insertPublic("입력검증-" + suffix, userId);
    channelService.join(userId, channelId);
    auth = "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void upload_withoutFilesPart_returns400() throws Exception {
    var other = new MockMultipartFile("other", "a.txt", "text/plain", "x".getBytes());
    mvc.perform(
            multipart("/api/v1/messaging/channels/" + channelId + "/attachments")
                .file(other)
                .header("Authorization", auth))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.files").exists());
  }

  @Test
  void list_withBrokenCursor_returns400InKorean() throws Exception {
    mvc.perform(
            get("/api/v1/messaging/channels/" + channelId + "/messages")
                .param("cursor", "@@")
                .header("Authorization", auth))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("목록 위치(cursor)가 올바르지 않습니다"));
  }

  /** WP-1583: Instant 끝 시각을 담은 커서 — 예전엔 OffsetDateTime 변환에서 500. 400 + 한국어 안내여야 한다. */
  @Test
  void list_withOutOfRangeCursorTime_returns400InKorean() throws Exception {
    mvc.perform(
            get("/api/v1/messaging/channels/" + channelId + "/messages")
                .param("cursor", rawCursor("31556889864403199|0|1"))
                .header("Authorization", auth))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("목록 위치(cursor)가 올바르지 않습니다"));
  }

  /** WP-1583: 칸이 덧붙은 커서 — 예전엔 넷째 칸을 버리고 200. 400 + 한국어 안내여야 한다. */
  @Test
  void list_withExtraCursorPart_returns400InKorean() throws Exception {
    mvc.perform(
            get("/api/v1/messaging/channels/" + channelId + "/messages")
                .param("cursor", rawCursor("1700000000|0|5|junk"))
                .header("Authorization", auth))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("목록 위치(cursor)가 올바르지 않습니다"));
  }

  /** 원문을 base64url(패딩 없음)로 감싸 조작된 커서 문자열을 만든다. */
  private static String rawCursor(String s) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(s.getBytes(StandardCharsets.UTF_8));
  }

  @Test
  void list_withNonPositiveLimit_isClampedTo1() throws Exception {
    mvc.perform(
            get("/api/v1/messaging/channels/" + channelId + "/messages")
                .param("limit", "-1")
                .header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.hasMore").value(Matchers.is(false)));
  }
}

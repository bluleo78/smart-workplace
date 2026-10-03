package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailReadSyncDispatcher;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** WP-187 읽음 조작 API — 안읽음·건수(asOf)·모두 읽음·소유 검증·asOf 경계(수신 시각·DB 적재 시각). */
@Transactional
class MailReadActionsControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
  @MockitoBean AssistantResolver assistantResolver;
  // 원격 읽음 반영 차단 — 이벤트가 리스너로 가도 외부 호출이 일어나지 않게 한다
  @MockitoBean MailReadSyncDispatcher dispatcher;

  @BeforeEach
  void noAssistantByDefault() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    when(assistantResolver.resolvePersonalOrEmpty(org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(Optional.empty());
  }

  // fetched(accountId, folderId, category, seen) — Task 1 의 헬퍼에 seen 인자를 더한 것(seen 이면
  // EMAIL_MESSAGE.SEEN=true 로 갱신)
  private long fetched(long accountId, long folderId, String category, boolean seen) {
    ParsedMessage msg =
        new ParsedMessage(
            System.nanoTime(),
            "m-" + System.nanoTime(),
            "t-" + System.nanoTime(),
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "제목",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫",
            List.of());
    long env = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    Long content =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(env))
            .fetchOneInto(Long.class);
    contentRepo.updateBody(content, "본문", null, "스니펫");
    TestFixtures.markMailFetched(dsl, env);
    if (category != null) {
      dsl.update(EMAIL_CONTENT)
          .set(EMAIL_CONTENT.AI_CATEGORY, category)
          .where(EMAIL_CONTENT.ID.eq(content))
          .execute();
    }
    // 수신 시각을 1시간 전으로 — asOf(테스트 tx 시작 시각)보다 앞서야 모두 읽음 대상에 든다
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, seen)
        .set(EMAIL_MESSAGE.RECEIVED_AT, OffsetDateTime.now().minusHours(1))
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    return env;
  }

  private String token(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  private boolean seen(long id) {
    return dsl.select(EMAIL_MESSAGE.SEEN)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne(EMAIL_MESSAGE.SEEN);
  }

  private String markAllBody(String category, String asOf) {
    return "{\"category\":"
        + (category == null ? "null" : "\"" + category + "\"")
        + ",\"needsReply\":false,\"query\":null,\"asOf\":\""
        + asOf
        + "\"}";
  }

  @Test
  void unread_marksUnseen_andIsIdempotent() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "ra1-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2], "업무", true);
    mvc.perform(post("/api/v1/mail/messages/{m}/unread", id).header("Authorization", token(box[0])))
        .andExpect(status().isOk());
    mvc.perform(post("/api/v1/mail/messages/{m}/unread", id).header("Authorization", token(box[0])))
        .andExpect(status().isOk());
    assertThat(seen(id)).isFalse();
  }

  @Test
  void unread_othersMessage_404_unchanged() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "ra2-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2], "업무", true);
    long other = TestFixtures.createHuman(dsl);
    mvc.perform(post("/api/v1/mail/messages/{m}/unread", id).header("Authorization", token(other)))
        .andExpect(status().isNotFound());
    assertThat(seen(id)).isTrue();
  }

  @Test
  void count_thenMarkAll_workView_excludesLateArrivals() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "ra3-" + System.nanoTime() + "@test.local");
    long a = fetched(box[1], box[2], "업무", false);
    long b = fetched(box[1], box[2], null, false);
    long personal = fetched(box[1], box[2], "개인", false);

    String body =
        mvc.perform(
                get("/api/v1/mail/accounts/{a}/messages/unread-count", box[1])
                    .param("category", "업무")
                    .header("Authorization", token(box[0])))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(2))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String asOf = com.jayway.jsonpath.JsonPath.read(body, "$.asOf");
    OffsetDateTime asOfTs = OffsetDateTime.parse(asOf);

    // 수신 시각이 asOf 이후인 도착분(R1 의 received_at 조건)
    long lateReceived = fetched(box[1], box[2], "업무", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.RECEIVED_AT, asOfTs.plusMinutes(1))
        .where(EMAIL_MESSAGE.ID.eq(lateReceived))
        .execute();
    // 수신 시각은 과거지만 asOf 이후 이 DB 에 들어온 도착분(R1 의 created_at 조건)
    long lateCreated = fetched(box[1], box[2], "업무", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.CREATED_AT, asOfTs.plusMinutes(1))
        .where(EMAIL_MESSAGE.ID.eq(lateCreated))
        .execute();

    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/mark-all-read", box[1])
                .header("Authorization", token(box[0]))
                .contentType(MediaType.APPLICATION_JSON)
                .content(markAllBody("업무", asOf)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(2));

    assertThat(seen(a)).isTrue();
    assertThat(seen(b)).isTrue();
    assertThat(seen(personal)).isFalse();
    assertThat(seen(lateReceived)).isFalse();
    assertThat(seen(lateCreated)).isFalse();
  }

  @Test
  void markAll_othersAccount_404_unchanged() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "ra4-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2], "업무", false);
    long other = TestFixtures.createHuman(dsl);
    mvc.perform(
            post("/api/v1/mail/accounts/{a}/messages/mark-all-read", box[1])
                .header("Authorization", token(other))
                .contentType(MediaType.APPLICATION_JSON)
                .content(markAllBody("업무", OffsetDateTime.now().toString())))
        .andExpect(status().isNotFound());
    assertThat(seen(id)).isFalse();
  }

  @Test
  void unreadCount_othersAccount_404() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "ra5-" + System.nanoTime() + "@test.local");
    long other = TestFixtures.createHuman(dsl);
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/messages/unread-count", box[1])
                .header("Authorization", token(other)))
        .andExpect(status().isNotFound());
  }
}

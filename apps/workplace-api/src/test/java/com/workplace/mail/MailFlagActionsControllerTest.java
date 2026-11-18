package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.event.MessagesSeenChangedEvent;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailReadSyncDispatcher;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.jooq.Record3;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1741 별표 API — {@code PUT /api/v1/mail/messages/{id}/flag} 가 flagged 와 서버 반영 대기를 켜고, 목록·상세 응답에
 * flagged 가 실리며, 남의 메일은 읽음 API 와 같은 404 인지. 변경 알림·역동기화 이벤트는 값이 바뀔 때만 나간다.
 */
@Transactional
@RecordApplicationEvents
class MailFlagActionsControllerTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired ApplicationEvents events;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
  @Autowired AssistantResolver assistantResolver;
  // 원격 반영 차단 — 이벤트가 리스너로 가도 외부 호출이 일어나지 않게 한다
  @MockitoBean MailReadSyncDispatcher dispatcher;

  @BeforeEach
  void noAssistantByDefault() {
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    when(assistantResolver.resolvePersonalOrEmpty(org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(Optional.empty());
  }

  /** 본문까지 적재된(상세 조회가 서버에 가지 않는) IMAP 메일 1통. */
  private long fetched(long accountId, long folderId) {
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
    return env;
  }

  private String token(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  /** flagged · flagged_push_pending · seen_push_pending. */
  private Record3<Boolean, Boolean, Boolean> state(long id) {
    return dsl.select(
            EMAIL_MESSAGE.FLAGGED,
            EMAIL_MESSAGE.FLAGGED_PUSH_PENDING,
            EMAIL_MESSAGE.SEEN_PUSH_PENDING)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne();
  }

  private org.springframework.test.web.servlet.ResultActions putFlag(
      long id, long userId, String body) throws Exception {
    return mvc.perform(
        put("/api/v1/mail/messages/{m}/flag", id)
            .header("Authorization", token(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  private List<MessagesSeenChangedEvent> syncEvents() {
    return events.stream(MessagesSeenChangedEvent.class).toList();
  }

  private List<ResourceChangedEvent> mailChanges() {
    return events.stream(ResourceChangedEvent.class)
        .filter(e -> "mail".equals(e.resource()))
        .toList();
  }

  @Test
  void flag_setsFlaggedAndPending_andListAndDetailShowIt() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "fl1-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2]);
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/messages", box[1])
                .header("Authorization", token(box[0])))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].flagged").value(false));

    putFlag(id, box[0], "{\"flagged\":true}").andExpect(status().isOk());

    var st = state(id);
    assertThat(st.value1()).isTrue();
    assertThat(st.value2()).isTrue(); // 서버 반영 대기
    assertThat(st.value3()).isFalse(); // 읽음 대기는 건드리지 않는다
    mvc.perform(
            get("/api/v1/mail/accounts/{a}/messages", box[1])
                .header("Authorization", token(box[0])))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(id))
        .andExpect(jsonPath("$[0].flagged").value(true));
    mvc.perform(
            get("/api/v1/mail/messages/{m}", id)
                .param("markSeen", "false")
                .header("Authorization", token(box[0])))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.flagged").value(true));

    // 끄기
    putFlag(id, box[0], "{\"flagged\":false}").andExpect(status().isOk());
    assertThat(state(id).value1()).isFalse();
    assertThat(state(id).value2()).isTrue();
  }

  @Test
  void flag_othersMessage_404_unchanged() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "fl2-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2]);
    long other = TestFixtures.createHuman(dsl);

    putFlag(id, other, "{\"flagged\":true}").andExpect(status().isNotFound());

    assertThat(state(id).value1()).isFalse();
    assertThat(state(id).value2()).isFalse();
    assertThat(syncEvents()).isEmpty();
  }

  @Test
  void flag_missingBody_400() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "fl3-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2]);

    putFlag(id, box[0], "{}").andExpect(status().isBadRequest());

    assertThat(state(id).value2()).isFalse();
  }

  @Test
  void flag_publishesSyncEventAndNotification_onlyWhenChanged() throws Exception {
    long[] box = TestFixtures.seedMailbox(dsl, "fl4-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2]);

    putFlag(id, box[0], "{\"flagged\":true}").andExpect(status().isOk());
    assertThat(syncEvents()).hasSize(1);
    assertThat(syncEvents().get(0).accountId()).isEqualTo(box[1]);
    assertThat(syncEvents().get(0).messageIds()).containsExactly(id);
    assertThat(mailChanges()).hasSize(1);
    assertThat(mailChanges().get(0).attrs())
        .containsEntry("accountId", box[1])
        .containsEntry("messageId", id);

    // 이미 별표 — 멱등이므로 추가 이벤트·알림 없음
    putFlag(id, box[0], "{\"flagged\":true}").andExpect(status().isOk());
    assertThat(syncEvents()).hasSize(1);
    assertThat(mailChanges()).hasSize(1);
  }
}

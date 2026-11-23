package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailDraftCount;
import com.workplace.mail.dto.MailScheduledSummary;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.QueuedSend;
import com.workplace.mail.exception.MailAlreadySendingException;
import com.workplace.mail.exception.MailDraftNotFoundException;
import com.workplace.mail.exception.MailDraftSendingException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailComposeService;
import com.workplace.mail.service.MailDraftService;
import com.workplace.mail.service.MailSendQueueService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayInputStream;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Properties;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 메일 예약 보내기(WP-1787) API 통합 — 보낼 시각 저장·1분 검증·100건 상한·예약 목록·개수·바로 보내기·예약 취소. 커밋을 봐야 하는 트랜잭션
 * 경계(advisory 락)가 있어 테스트 트랜잭션 없이 돌고, 시드는 {@link #cleanup} 에서 지운다.
 */
class MailScheduleSendIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MockMvc mockMvc;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired MailSendQueueService queueService;
  @Autowired MailDraftService draftService;
  @Autowired MailDraftRepository draftRepo;
  @Autowired EncryptionService encryption;
  @Autowired MailComposeService composeService;
  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphTokenService graphTokenService;

  private final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  /** 계정(임시보관 CASCADE) → 사용자 순으로 정리. */
  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (!users.isEmpty()) {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.USER_ID.in(users)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
          }
        });
    users.clear();
    TenantContext.clear();
  }

  private long user() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  private long account(long user) {
    return MailTestSupport.seedGraphAccount(dsl, encryption, user);
  }

  /** 같은 사용자의 두 번째 계정 — 시드 헬퍼의 주소가 사용자당 하나라 주소를 달리해 직접 넣는다(유니크 제약). */
  private long secondAccount(long user) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, user)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "second-" + user + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "두 번째 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 예약(sendAt)·즉시(null) 보내기 요청 — 받는사람·제목·본문만. */
  private MailSendRequest req(Long draftId, OffsetDateTime sendAt) {
    return new MailSendRequest(
        List.of("peer@example.com"),
        List.of(),
        List.of(),
        "제목",
        "<p>본문</p>",
        "본문",
        null,
        null,
        null,
        null,
        draftId,
        null,
        null,
        null,
        null,
        sendAt);
  }

  private OffsetDateTime in(long hours) {
    return OffsetDateTime.now().plusHours(hours).truncatedTo(ChronoUnit.SECONDS);
  }

  /** 저장소로 직접 넣은 예약(QUEUED·예약) 행 — 상한 시드. */
  private long seedScheduled(long user, long account, OffsetDateTime sendAt) {
    return dsl.insertInto(MAIL_DRAFT)
        .set(MAIL_DRAFT.USER_ID, user)
        .set(MAIL_DRAFT.ACCOUNT_ID, account)
        .set(MAIL_DRAFT.SUBJECT, "시드")
        .set(MAIL_DRAFT.SEND_STATE, "QUEUED")
        .set(MAIL_DRAFT.SEND_AT, sendAt)
        .set(MAIL_DRAFT.SENT_BY_SCHEDULE, true)
        .returning(MAIL_DRAFT.ID)
        .fetchOne()
        .getId();
  }

  private OffsetDateTime sendAtOf(long id) {
    return dsl.select(MAIL_DRAFT.SEND_AT)
        .from(MAIL_DRAFT)
        .where(MAIL_DRAFT.ID.eq(id))
        .fetchOne(MAIL_DRAFT.SEND_AT);
  }

  private String stateOf(long id) {
    return dsl.select(MAIL_DRAFT.SEND_STATE)
        .from(MAIL_DRAFT)
        .where(MAIL_DRAFT.ID.eq(id))
        .fetchOne(MAIL_DRAFT.SEND_STATE);
  }

  /**
   * 기밀 예약(WP-2029) — 예약 행에 표시가 남고, 스케줄러가 하듯 행을 요청으로 되돌려 실제 전송하면 나간 MIME 의 Subject 에 「[기밀] 」 머리말과
   * Sensitivity 헤더가 실린다(전송 캡처는 MailComposeServiceTest 와 같은 GraphApiClient 목).
   */
  @Test
  void confidentialScheduleSendsWithPrefixAndSensitivityHeader() throws Exception {
    long me = user();
    long acc = account(me);
    when(graphTokenService.getAccessToken(anyLong(), anyLong())).thenReturn("FAKE_TOKEN");
    MailSendRequest base = req(null, in(2));
    MailSendRequest conf =
        new MailSendRequest(
            base.to(),
            base.cc(),
            base.bcc(),
            base.subject(),
            base.bodyHtml(),
            base.bodyText(),
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            base.sendAt(),
            true);

    QueuedSend q = queueService.enqueue(me, acc, conf);
    dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, "SENDING")
        .where(MAIL_DRAFT.ID.eq(q.draftId()))
        .execute();
    var row = draftRepo.startSend(q.draftId()).orElseThrow();
    MailSendRequest back = queueService.toSendRequest(row);
    assertThat(back.isConfidential()).isTrue();
    composeService.send(me, acc, back);

    ArgumentCaptor<String> cap = ArgumentCaptor.forClass(String.class);
    verify(graphApiClient).sendMail(eq("FAKE_TOKEN"), cap.capture());
    MimeMessage sent =
        new MimeMessage(
            Session.getInstance(new Properties()),
            new ByteArrayInputStream(Base64.getDecoder().decode(cap.getValue())));
    assertThat(sent.getSubject()).isEqualTo("[기밀] 제목");
    assertThat(sent.getHeader("Sensitivity", null)).isEqualTo("Company-Confidential");

    // 실제 발송 경로(composeService.send)가 보낸 사본에도 머리말 적용 제목과 기밀 표시를 저장한다
    var stored =
        dsl.select(EMAIL_CONTENT.SUBJECT, EMAIL_CONTENT.CONFIDENTIAL)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(acc))
            .fetchOne();
    assertThat(stored).isNotNull();
    assertThat(stored.get(EMAIL_CONTENT.SUBJECT)).isEqualTo("[기밀] 제목");
    assertThat(stored.get(EMAIL_CONTENT.CONFIDENTIAL)).isTrue();
  }

  @Test
  void scheduleStoresSendAtAndFlag() {
    long me = user();
    long acc = account(me);
    OffsetDateTime at = in(2);

    QueuedSend q = queueService.enqueue(me, acc, req(null, at));

    assertThat(q.sendAt().toInstant()).isEqualTo(at.toInstant());
    assertThat(stateOf(q.draftId())).isEqualTo("QUEUED");
    assertThat(sendAtOf(q.draftId()).toInstant()).isEqualTo(at.toInstant());
    assertThat(
            dsl.select(MAIL_DRAFT.SENT_BY_SCHEDULE)
                .from(MAIL_DRAFT)
                .where(MAIL_DRAFT.ID.eq(q.draftId()))
                .fetchOne(MAIL_DRAFT.SENT_BY_SCHEDULE))
        .isTrue();
    MailDraftCount count = draftService.count(me, acc);
    assertThat(count).extracting("count", "queued", "scheduled").containsExactly(0L, 1L, 1L);
    assertThat(count.nextSendAt().toInstant()).isEqualTo(at.toInstant());
    List<MailScheduledSummary> list = draftService.listScheduled(me, acc);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).id()).isEqualTo(q.draftId());
    assertThat(list.get(0).sendAt().toInstant()).isEqualTo(at.toInstant());
  }

  @Test
  void instantSendIsNotScheduled() {
    long me = user();
    long acc = account(me);

    queueService.enqueue(me, acc, req(null, null));

    assertThat(draftService.count(me, acc)).isEqualTo(new MailDraftCount(0, 1, 0, null));
    assertThat(draftService.listScheduled(me, acc)).isEmpty();
  }

  @Test
  void rejectsPastAndWithinOneMinute() {
    long me = user();
    long acc = account(me);

    for (OffsetDateTime bad :
        List.of(OffsetDateTime.now().minusMinutes(1), OffsetDateTime.now().plusSeconds(30))) {
      assertThatThrownBy(() -> queueService.enqueue(me, acc, req(null, bad)))
          .isInstanceOf(MailValidationException.class)
          .hasMessage("예약 시각은 지금부터 1분 뒤 이후로 골라 주세요");
    }
    assertThat(dsl.fetchCount(MAIL_DRAFT, MAIL_DRAFT.USER_ID.eq(me))).isZero();
  }

  /** 1년보다 먼 예약은 400(코드 리뷰) — 1년 안 끝자락은 통과한다. */
  @Test
  void rejectsMoreThanOneYearAhead() {
    long me = user();
    long acc = account(me);

    OffsetDateTime tooFar = OffsetDateTime.now().plusDays(366);
    assertThatThrownBy(() -> queueService.enqueue(me, acc, req(null, tooFar)))
        .isInstanceOf(MailValidationException.class)
        .hasMessage("예약 시각은 지금부터 1년 안으로 골라 주세요");
    assertThat(dsl.fetchCount(MAIL_DRAFT, MAIL_DRAFT.USER_ID.eq(me))).isZero();

    OffsetDateTime nearYear = OffsetDateTime.now().plusDays(364);
    assertThat(queueService.enqueue(me, acc, req(null, nearYear)).draftId()).isPositive();
  }

  @Test
  void capsAt100PerUser() {
    long me = user();
    long acc1 = account(me);
    long acc2 = secondAccount(me);
    for (int i = 0; i < 100; i++) {
      seedScheduled(me, i % 2 == 0 ? acc1 : acc2, in(3));
    }

    assertThatThrownBy(() -> queueService.enqueue(me, acc1, req(null, in(2))))
        .isInstanceOf(MailValidationException.class)
        .hasMessage("예약은 100건까지");
    // 즉시 보내기는 상한과 무관하다.
    assertThat(queueService.enqueue(me, acc1, req(null, null)).draftId()).isPositive();
  }

  @Test
  void reschedulingOwnRowDoesNotCountAgainstCap() {
    long me = user();
    long acc = account(me);
    long first = queueService.enqueue(me, acc, req(null, in(2))).draftId();
    for (int i = 0; i < 99; i++) {
      seedScheduled(me, acc, in(3));
    }
    assertThat(draftRepo.countScheduledByUser(me, null)).isEqualTo(100);

    queueService.cancel(me, first);
    QueuedSend again = queueService.enqueue(me, acc, req(first, in(4)));

    assertThat(again.draftId()).isEqualTo(first);
    assertThat(draftRepo.countScheduledByUser(me, null)).isEqualTo(100);
  }

  @Test
  void sendOnScheduledRowIs409() {
    long me = user();
    long acc = account(me);
    long id = queueService.enqueue(me, acc, req(null, in(2))).draftId();

    assertThatThrownBy(() -> queueService.enqueue(me, acc, req(id, in(3))))
        .isInstanceOf(MailDraftSendingException.class);
  }

  @Test
  void sendNowMovesSendAtToNow() {
    long me = user();
    long other = user();
    long acc = account(me);
    long scheduled = queueService.enqueue(me, acc, req(null, in(2))).draftId();

    QueuedSend q = queueService.sendNow(me, scheduled);

    assertThat(q.draftId()).isEqualTo(scheduled);
    assertThat(sendAtOf(scheduled)).isBeforeOrEqualTo(draftRepo.dbNow());
    assertThat(stateOf(scheduled)).isEqualTo("QUEUED");

    long sending = seedScheduled(me, acc, in(2));
    dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, "SENDING")
        .where(MAIL_DRAFT.ID.eq(sending))
        .execute();
    assertThatThrownBy(() -> queueService.sendNow(me, sending))
        .isInstanceOf(MailAlreadySendingException.class);

    long instant = queueService.enqueue(me, acc, req(null, null)).draftId();
    assertThatThrownBy(() -> queueService.sendNow(me, instant))
        .isInstanceOf(MailDraftNotFoundException.class);
    long mine = queueService.enqueue(me, acc, req(null, in(2))).draftId();
    assertThatThrownBy(() -> queueService.sendNow(other, mine))
        .isInstanceOf(MailDraftNotFoundException.class);
  }

  @Test
  void cancelScheduledReturnsToDrafts() {
    long me = user();
    long acc = account(me);
    long id = queueService.enqueue(me, acc, req(null, in(2))).draftId();

    queueService.cancel(me, id);

    assertThat(sendAtOf(id)).isNull();
    assertThat(draftService.count(me, acc)).isEqualTo(new MailDraftCount(1, 0, 0, null));
  }

  /**
   * 바로 보내기 뒤(보낼 시각이 지난 예약 행)에는 예약 취소·열기가 풀지 못한다(코드 리뷰) — 곧 스케줄러가 집을 메일을 되돌리지 않게 409
   * ALREADY_SENDING, 행은 QUEUED 그대로. 즉시 보내기의 되돌리기(WP-1786)는 영향이 없다.
   */
  @Test
  void cancelAfterSendNowIs409() throws Exception {
    long me = user();
    long acc = account(me);
    long id = queueService.enqueue(me, acc, req(null, in(2))).draftId();
    queueService.sendNow(me, id);

    assertThatThrownBy(() -> queueService.cancel(me, id))
        .isInstanceOf(MailAlreadySendingException.class);
    assertThat(stateOf(id)).isEqualTo("QUEUED");
    assertThat(sendAtOf(id)).isNotNull();

    String bearer = "Bearer " + jwtTokenProvider.generateAccessToken(me, "u" + me, 1L);
    mockMvc
        .perform(post("/api/v1/mail/drafts/" + id + "/cancel-send").header("Authorization", bearer))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("ALREADY_SENDING"));
    TenantContext.set(1L);
    assertThat(stateOf(id)).isEqualTo("QUEUED");

    // 즉시 보내기 되돌리기는 그대로 풀린다.
    long instant = queueService.enqueue(me, acc, req(null, null)).draftId();
    assertThat(queueService.cancel(me, instant).id()).isEqualTo(instant);
    assertThat(stateOf(instant)).isNull();
  }

  @Test
  void listScheduledOrderAndScope() {
    long me = user();
    long other = user();
    long acc = account(me);
    long acc2 = secondAccount(me);
    long otherAcc = account(other);
    long late = seedScheduled(me, acc, in(5));
    long early = seedScheduled(me, acc, in(2));
    seedScheduled(me, acc2, in(1));
    seedScheduled(other, otherAcc, in(1));
    queueService.enqueue(me, acc, req(null, null));
    long sending = seedScheduled(me, acc, in(1));
    dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, "SENDING")
        .where(MAIL_DRAFT.ID.eq(sending))
        .execute();

    assertThat(draftService.listScheduled(me, acc))
        .extracting(MailScheduledSummary::id)
        .containsExactly(early, late);
  }

  /** HTTP 모양 — sendAt 요청, scheduled 개수, 예약 목록, send-now 응답과 오류 코드. */
  @Test
  void httpShapes() throws Exception {
    long me = user();
    long acc = account(me);
    String bearer = "Bearer " + jwtTokenProvider.generateAccessToken(me, "u" + me, 1L);
    String json =
        "{\"to\":[\"peer@example.com\"],\"subject\":\"s\",\"bodyHtml\":\"<p>x</p>\","
            + "\"bodyText\":\"x\",\"sendAt\":\""
            + in(2)
            + "\"}";

    String res =
        mockMvc
            .perform(
                post("/api/v1/mail/accounts/" + acc + "/send")
                    .header("Authorization", bearer)
                    .contentType("application/json")
                    .content(json))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sendAt").isNotEmpty())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long id = ((Number) JsonPath.read(res, "$.draftId")).longValue();

    mockMvc
        .perform(
            get("/api/v1/mail/drafts/count")
                .param("accountId", String.valueOf(acc))
                .header("Authorization", bearer))
        .andExpect(jsonPath("$.count").value(0))
        .andExpect(jsonPath("$.queued").value(1))
        .andExpect(jsonPath("$.scheduled").value(1))
        .andExpect(jsonPath("$.nextSendAt").isNotEmpty());
    mockMvc
        .perform(
            get("/api/v1/mail/drafts/scheduled")
                .param("accountId", String.valueOf(acc))
                .header("Authorization", bearer))
        .andExpect(jsonPath("$[0].id").value(id))
        .andExpect(jsonPath("$[0].sendAt").isNotEmpty())
        .andExpect(jsonPath("$[0].to[0]").value("peer@example.com"));
    mockMvc
        .perform(post("/api/v1/mail/drafts/" + id + "/send-now").header("Authorization", bearer))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.draftId").value(id));
    dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, "SENDING")
        .where(MAIL_DRAFT.ID.eq(id))
        .execute();
    mockMvc
        .perform(post("/api/v1/mail/drafts/" + id + "/send-now").header("Authorization", bearer))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("ALREADY_SENDING"));

    // 없는 예약 행 바로 보내기 → 404.
    mockMvc
        .perform(
            post("/api/v1/mail/drafts/" + (id + 1_000_000) + "/send-now")
                .header("Authorization", bearer))
        .andExpect(status().isNotFound());

    // 예약 시각이 지금부터 1분 안이면 400 + 표준 오류 바디의 message.
    String tooSoon =
        "{\"to\":[\"peer@example.com\"],\"subject\":\"s\",\"bodyHtml\":\"<p>x</p>\","
            + "\"bodyText\":\"x\",\"sendAt\":\""
            + OffsetDateTime.now().plusSeconds(20)
            + "\"}";
    mockMvc
        .perform(
            post("/api/v1/mail/accounts/" + acc + "/send")
                .header("Authorization", bearer)
                .contentType("application/json")
                .content(tooSoon))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("예약 시각은 지금부터 1분 뒤 이후로 골라 주세요"));

    // 위 행은 바로 보내기·보내는 중으로 예약에서 빠졌다 — 시드 100건을 채우면 새 예약은 400 + message.
    for (int i = 0; i < 100; i++) {
      seedScheduled(me, acc, in(3));
    }
    mockMvc
        .perform(
            post("/api/v1/mail/accounts/" + acc + "/send")
                .header("Authorization", bearer)
                .contentType("application/json")
                .content(json))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("예약은 100건까지"));
    TenantContext.set(1L);
  }
}

package com.workplace.mail;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.workplace.calendar.repository.CalendarInviteEventRepository;
import com.workplace.calendar.repository.CalendarInviteEventRepository.InviteEventValues;
import com.workplace.calendar.service.CalendarService;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.CalendarInvite;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.exception.MailInviteNotFoundException;
import com.workplace.mail.exception.MailInviteNotRespondableException;
import com.workplace.mail.outbound.MailInviteCalendarPort;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.mail.service.invite.MailInviteService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Message;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Arrays;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-986 IMAP 계정의 일정 초대 — 본문 적재 때 초대 기록 → 상세 calendarInvite, 응답 → 주최자에게 iCalendar REPLY
 * 메일(GreenMail 이 받음) + 내 캘린더 일정 생성·변경·거절, 취소 메일 → 일정 취소 표시, 옛 SEQUENCE → outdated.
 */
@Transactional
class MailCalendarInviteImapTest extends ExternalClientMockedTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(MailTestPorts.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailMessageService messageService;
  @Autowired MailInviteService inviteService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;
  @Autowired CalendarInviteEventRepository inviteEventRepo;
  @Autowired CalendarService calendarService;

  /** 응답을 보낸 뒤 캘린더 반영이 실패하는 경우를 만들 때만 끼어든다(기본은 실제 구현). */
  @MockitoSpyBean MailInviteCalendarPort calendarPort;

  static final String UID = "wp986-invite@google.com";

  /** Google 형태의 초대 iCalendar(나 = box@test.local 이 참석자). */
  static String ics(String method, int sequence, String start) {
    return ics(method, sequence, start, "boss@x.com");
  }

  /** 주최자를 바꾼 초대(위조 메일 흉내). */
  static String ics(String method, int sequence, String start, String organizer) {
    return String.join(
        "\r\n",
        "BEGIN:VCALENDAR",
        "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
        "VERSION:2.0",
        "METHOD:" + method,
        "BEGIN:VEVENT",
        "DTSTART;TZID=Asia/Seoul:" + start,
        "DTEND;TZID=Asia/Seoul:" + start.substring(0, 9) + "110000",
        "DTSTAMP:20261028T010203Z",
        "ORGANIZER;CN=주최자:mailto:" + organizer,
        "UID:" + UID,
        "ATTENDEE;PARTSTAT=ACCEPTED;CN=주최자:mailto:boss@x.com",
        "ATTENDEE;PARTSTAT=NEEDS-ACTION;CN=나:mailto:box@test.local",
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:peer@x.com",
        "SEQUENCE:" + sequence,
        "SUMMARY:분기 계획 회의",
        "LOCATION:본사 3층",
        "END:VEVENT",
        "END:VCALENDAR",
        "");
  }

  /** 초대 메일(alternative: text/plain + text/calendar) 1통을 받게 하고 동기화 후 그 메일 id 를 돌려준다. */
  private long deliverInvite(long user, long accountId, String subject, String calendar)
      throws Exception {
    return deliverInvite(user, accountId, subject, calendar, null);
  }

  /**
   * @param transferEncoding text/calendar 파트의 Content-Transfer-Encoding(null 이면 JavaMail 이 고른다)
   */
  private long deliverInvite(
      long user, long accountId, String subject, String calendar, String transferEncoding)
      throws Exception {
    MimeMessage msg = new MimeMessage(greenMail.getSmtp().createSession());
    msg.setFrom("boss@x.com");
    msg.setRecipients(Message.RecipientType.TO, "box@test.local");
    msg.setSubject(subject, "UTF-8");
    MimeBodyPart text = new MimeBodyPart();
    text.setText("초대합니다", "UTF-8");
    MimeBodyPart cal = new MimeBodyPart();
    cal.setContent(calendar, "text/calendar; charset=UTF-8; method=REQUEST");
    if (transferEncoding != null) cal.setHeader("Content-Transfer-Encoding", transferEncoding);
    MimeMultipart alt = new MimeMultipart("alternative");
    alt.addBodyPart(text);
    alt.addBodyPart(cal);
    msg.setContent(alt);
    msg.saveChanges();
    int before = greenMail.getReceivedMessages().length;
    GreenMailUtil.sendMimeMessage(msg);
    greenMail.waitForIncomingEmail(before + 1);
    syncService.sync(user, accountId);
    return messageRepo.listByAccount(accountId, "INBOX", subject, 10).get(0).id();
  }

  private long newAccount(long user) {
    return MailTestSupport.insertAccount(accountRepo, encryption, user, false);
  }

  /** GreenMail 이 받은 주최자(boss@x.com)행 응답 메일들. */
  private MimeMessage[] replies() {
    return Arrays.stream(greenMail.getReceivedMessages())
        .filter(
            m -> {
              try {
                return Arrays.stream(m.getAllRecipients())
                    .anyMatch(a -> a.toString().contains("boss@x.com"));
              } catch (Exception e) {
                return false;
              }
            })
        .toArray(MimeMessage[]::new);
  }

  /** 메시지의 text/calendar 파트 원문. */
  private static String calendarPart(Part part) throws Exception {
    if (part.isMimeType("multipart/*")) {
      Multipart mp = (Multipart) part.getContent();
      for (int i = 0; i < mp.getCount(); i++) {
        String s = calendarPart(mp.getBodyPart(i));
        if (s != null) return s;
      }
      return null;
    }
    if (!part.isMimeType("text/calendar")) return null;
    try (InputStream is = part.getInputStream()) {
      return new String(is.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  @Test
  void invite_detailHasCalendarInvite() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 분기 계획", ics("REQUEST", 0, "20261103T100000"));

    CalendarInvite inv = messageService.get(user, id, false).calendarInvite();

    assertThat(inv).isNotNull();
    assertThat(inv.method()).isEqualTo("REQUEST");
    assertThat(inv.uid()).isEqualTo(UID);
    assertThat(inv.summary()).isEqualTo("분기 계획 회의");
    assertThat(inv.location()).isEqualTo("본사 3층");
    assertThat(inv.start().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-03T10:00:00+09:00").toInstant());
    assertThat(inv.allDay()).isFalse();
    assertThat(inv.organizer()).isEqualTo(new CalendarInvite.Organizer("주최자", "boss@x.com"));
    assertThat(inv.attendeeCount()).isEqualTo(3);
    assertThat(inv.myResponse()).isEqualTo("NEEDS_ACTION");
    assertThat(inv.eventId()).isNull();
    assertThat(inv.outdated()).isFalse();
    assertThat(inv.canRespond()).isTrue();
  }

  @Test
  void nonInvite_hasNoCalendarInvite_andRespondIs404() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    MailTestPorts.sendText("box@test.local", "a@x.com", "그냥 메일", "본문");
    greenMail.waitForIncomingEmail(1);
    syncService.sync(user, accountId);
    long id = messageRepo.listByAccount(accountId, "INBOX", null, 10).get(0).id();

    EmailMessageDetail d = messageService.get(user, id, false);

    assertThat(d.calendarInvite()).isNull();
    assertThatThrownBy(() -> inviteService.respond(user, id, "ACCEPTED"))
        .isInstanceOf(MailInviteNotFoundException.class);
  }

  /**
   * 수락 → REPLY 메일(METHOD:REPLY, PARTSTAT=ACCEPTED, 같은 UID) + 기본 캘린더 일정 생성 → 미정으로 바꾸면 같은 일정을 고친다.
   */
  @Test
  void accept_sendsReply_andCreatesEvent_thenTentativeUpdatesSameEvent() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 수락", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false); // 본문 적재 → 초대 기록

    CalendarInvite accepted = inviteService.respond(user, id, "ACCEPTED");

    // REPLY 메일
    greenMail.waitForIncomingEmail(2);
    MimeMessage[] replies = replies();
    assertThat(replies).hasSize(1);
    assertThat(replies[0].getSubject()).isEqualTo("수락: 분기 계획 회의");
    assertThat(replies[0].getContentType()).startsWith("multipart/alternative");
    String reply = calendarPart(replies[0]).replace("\r\n ", "");
    assertThat(reply)
        .contains("METHOD:REPLY", "UID:" + UID, "SEQUENCE:0", "ORGANIZER")
        .contains("PARTSTAT=ACCEPTED:mailto:box@test.local")
        .contains("DTSTART:20261103T010000Z");
    // 캘린더 일정
    assertThat(accepted.eventId()).isNotNull();
    assertThat(accepted.myResponse()).isEqualTo("ACCEPTED");
    var ev =
        dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(accepted.eventId())).fetchOne();
    assertThat(ev.getOwnerId()).isEqualTo(user);
    assertThat(ev.getIcalUid()).isEqualTo(UID);
    assertThat(ev.getTitle()).isEqualTo("분기 계획 회의");
    assertThat(ev.getExternalId()).isNull();
    assertThat(myRsvp(accepted.eventId(), user)).isEqualTo("ACCEPTED");
    // 주최자(ORGANIZER) + 나 + 동료
    assertThat(dsl.fetchCount(EVENT_ATTENDEE, EVENT_ATTENDEE.EVENT_ID.eq(accepted.eventId())))
        .isEqualTo(3);

    CalendarInvite tentative = inviteService.respond(user, id, "TENTATIVE");

    assertThat(tentative.eventId()).isEqualTo(accepted.eventId());
    assertThat(tentative.myResponse()).isEqualTo("TENTATIVE");
    assertThat(myRsvp(accepted.eventId(), user)).isEqualTo("TENTATIVE");
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.ICAL_UID.eq(UID))).isEqualTo(1);
    greenMail.waitForIncomingEmail(3);
    assertThat(calendarPart(replies()[1])).contains("PARTSTAT=TENTATIVE");
  }

  /** 거절 — 일정이 없으면 새로 넣지 않고 카드의 내 응답만 DECLINED, 넣어 둔 일정이 있으면 내 응답을 DECLINED 로. */
  @Test
  void decline_doesNotCreate_butUpdatesExisting() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 거절", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);

    CalendarInvite declined = inviteService.respond(user, id, "DECLINED");

    assertThat(declined.eventId()).isNull();
    assertThat(declined.myResponse()).isEqualTo("DECLINED");
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.ICAL_UID.eq(UID))).isZero();
    greenMail.waitForIncomingEmail(2);
    assertThat(calendarPart(replies()[0])).contains("PARTSTAT=DECLINED");

    CalendarInvite accepted = inviteService.respond(user, id, "ACCEPTED");
    CalendarInvite declinedAgain = inviteService.respond(user, id, "DECLINED");

    assertThat(declinedAgain.eventId()).isEqualTo(accepted.eventId());
    assertThat(declinedAgain.myResponse()).isEqualTo("DECLINED");
    assertThat(myRsvp(accepted.eventId(), user)).isEqualTo("DECLINED");
  }

  /** 취소 메일 → 넣어 둔 같은 UID 일정을 취소 표시, 카드는 CANCEL·응답 불가. */
  @Test
  void cancel_marksEventCancelled() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 원본", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);
    long eventId = inviteService.respond(user, id, "ACCEPTED").eventId();

    long cancelId = deliverInvite(user, accountId, "취소: 원본", ics("CANCEL", 1, "20261103T100000"));
    CalendarInvite cancel = messageService.get(user, cancelId, false).calendarInvite();

    assertThat(cancel.method()).isEqualTo("CANCEL");
    assertThat(cancel.canRespond()).isFalse();
    assertThat(cancel.eventId()).isEqualTo(eventId);
    var ev = dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eventId)).fetchOne();
    assertThat(ev.getCancelledAt()).isNotNull();
    assertThat(ev.getTitle()).isEqualTo("취소됨: 분기 계획 회의");
    assertThatThrownBy(() -> inviteService.respond(user, cancelId, "ACCEPTED"))
        .isInstanceOf(MailInviteNotRespondableException.class);
  }

  /** 옛 SEQUENCE 초대 — 더 최신 초대 메일을 알면 outdated·응답 불가(409). 최신 메일은 응답할 수 있다. */
  @Test
  void olderSequence_isOutdated() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long oldId = deliverInvite(user, accountId, "초대: 옛", ics("REQUEST", 0, "20261103T100000"));
    long newId = deliverInvite(user, accountId, "초대: 새", ics("REQUEST", 1, "20261104T100000"));
    messageService.get(user, oldId, false);
    messageService.get(user, newId, false);

    CalendarInvite old = messageService.get(user, oldId, false).calendarInvite();
    CalendarInvite latest = messageService.get(user, newId, false).calendarInvite();

    assertThat(old.outdated()).isTrue();
    assertThat(old.canRespond()).isFalse();
    assertThat(latest.outdated()).isFalse();
    assertThat(latest.canRespond()).isTrue();
    assertThatThrownBy(() -> inviteService.respond(user, oldId, "ACCEPTED"))
        .isInstanceOf(MailInviteNotRespondableException.class);
  }

  /** 다른 사람의 메일에는 응답할 수 없다(404 — 존재 은닉). */
  @Test
  void othersMail_isNotFound() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 남", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);

    assertThat(inviteService.view(other, id)).isNull();
    assertThatThrownBy(() -> inviteService.respond(other, id, "ACCEPTED"))
        .isInstanceOf(com.workplace.mail.exception.EmailMessageNotFoundException.class);
  }

  private String myRsvp(long eventId, long user) {
    return dsl.select(EVENT_ATTENDEE.RSVP_STATUS)
        .from(EVENT_ATTENDEE)
        .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
        .and(EVENT_ATTENDEE.USER_ID.eq(user))
        .fetchOne(EVENT_ATTENDEE.RSVP_STATUS);
  }

  /**
   * 깨진·적대적 iCalendar(quoted-printable {@code =00} 으로 SUMMARY 에 NUL, 아주 큰 DURATION)도 본문 적재를 막지 않는다 —
   * 본문은 적재되고 카드는 제어 문자를 지운 값(끝은 버림).
   */
  @Test
  void hostileIcs_bodyStillLoads_andCardIsSanitized() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    String calendar =
        ics("REQUEST", 0, "20261103T100000")
            .replace("SUMMARY:분기 계획 회의", "SUMMARY:분기\u0000계획")
            .replace("DTEND;TZID=Asia/Seoul:20261103T110000", "DURATION:P99999999W");
    long id = deliverInvite(user, accountId, "초대: 깨짐", calendar, "quoted-printable");

    EmailMessageDetail d = messageService.get(user, id, false);

    assertThat(d.bodyText()).contains("초대합니다");
    // 원문에 정말 =00(quoted-printable NUL)이 실려 왔다
    MimeMessage[] received = greenMail.getReceivedMessages();
    assertThat(GreenMailUtil.getWholeMessage(received[received.length - 1])).contains("=00");
    // 본문 적재 완료 표시까지 커밋 경로를 탔다(초대 기록 실패가 적재를 깨지 않음)
    assertThat(
            dsl.select(EMAIL_MESSAGE.FETCHED_AT)
                .from(EMAIL_MESSAGE)
                .where(EMAIL_MESSAGE.ID.eq(id))
                .fetchOne(EMAIL_MESSAGE.FETCHED_AT))
        .isNotNull();
    CalendarInvite inv = d.calendarInvite();
    if (inv != null) {
      assertThat(inv.summary()).isEqualTo("분기계획");
      assertThat(inv.end()).isNull();
    }
  }

  /** 시작이 범위(1900~9999년) 밖인 초대는 초대 없는 메일 — 본문은 그대로 적재된다. */
  @Test
  void outOfRangeStart_isNoInvite_bodyLoads() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    String calendar =
        ics("REQUEST", 0, "20261103T100000")
            .replace("DTSTART;TZID=Asia/Seoul:20261103T100000", "DTSTART:00010101T000000Z");
    long id = deliverInvite(user, accountId, "초대: 옛날", calendar);

    EmailMessageDetail d = messageService.get(user, id, false);

    assertThat(d.bodyText()).contains("초대합니다");
    assertThat(d.calendarInvite()).isNull();
  }

  /** 다른 주소(주최자 아님)가 보낸 같은 UID 취소 메일은 내 일정을 취소하지 않고, 진짜 초대도 막지 않는다. */
  @Test
  void forgedCancel_fromOtherOrganizer_isIgnored() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 진짜", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);
    long eventId = inviteService.respond(user, id, "ACCEPTED").eventId();

    long forged =
        deliverInvite(user, accountId, "취소: 위조", ics("CANCEL", 5, "20261103T100000", "evil@y.com"));
    messageService.get(user, forged, false);

    var ev = dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eventId)).fetchOne();
    assertThat(ev.getCancelledAt()).isNull();
    assertThat(ev.getTitle()).isEqualTo("분기 계획 회의");
    CalendarInvite real = inviteService.view(user, id);
    assertThat(real.outdated()).isFalse();
    assertThat(real.canRespond()).isTrue();
  }

  /** 주최자 대소문자만 다른 진짜 취소는 반영한다. */
  @Test
  void cancel_organizerCaseInsensitive() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 대소문자", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);
    long eventId = inviteService.respond(user, id, "ACCEPTED").eventId();

    long cancel =
        deliverInvite(
            user, accountId, "취소: 대소문자", ics("CANCEL", 1, "20261103T100000", "BOSS@X.COM"));
    messageService.get(user, cancel, false);

    var ev = dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eventId)).fetchOne();
    assertThat(ev.getCancelledAt()).isNotNull();
  }

  /** 다른 주최자의 같은 UID·더 큰 SEQUENCE 초대(위조)는 진짜 초대를 낡게(outdated) 만들지 못한다. */
  @Test
  void forgedHigherSequence_fromOtherOrganizer_doesNotOutdateReal() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 진짜2", ics("REQUEST", 0, "20261103T100000"));
    long forged =
        deliverInvite(
            user, accountId, "초대: 위조2", ics("REQUEST", 9, "20261104T100000", "evil@y.com"));
    messageService.get(user, id, false);
    messageService.get(user, forged, false);

    CalendarInvite real = inviteService.view(user, id);

    assertThat(real.outdated()).isFalse();
    assertThat(real.canRespond()).isTrue();
    // 진짜 초대에 수락해 일정이 생긴 뒤, 위조 초대는 남의(주최자 다른) 일정이라 응답할 수 없다 — 진짜 일정을 덮어쓰지 못한다
    long eventId = inviteService.respond(user, id, "ACCEPTED").eventId();
    CalendarInvite fake = inviteService.view(user, forged);
    assertThat(fake.canRespond()).isFalse();
    assertThat(fake.eventId()).isNull();
    assertThatThrownBy(() -> inviteService.respond(user, forged, "ACCEPTED"))
        .isInstanceOf(MailInviteNotRespondableException.class);
    var ev = dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eventId)).fetchOne();
    assertThat(ev.getStartsAt().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-03T10:00:00+09:00").toInstant());
  }

  /** 같은 SEQUENCE 의 취소가 오면 초대는 응답할 수 없고(이후 변경), 수락해도 취소된 일정이 되살아나지 않는다. */
  @Test
  void sameSequenceCancel_blocksRequest_andDoesNotUncancel() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 같은seq", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);
    long eventId = inviteService.respond(user, id, "ACCEPTED").eventId();
    long cancel = deliverInvite(user, accountId, "취소: 같은seq", ics("CANCEL", 0, "20261103T100000"));
    messageService.get(user, cancel, false);

    CalendarInvite req = inviteService.view(user, id);

    assertThat(req.outdated()).isTrue();
    assertThat(req.canRespond()).isFalse();
    assertThatThrownBy(() -> inviteService.respond(user, id, "TENTATIVE"))
        .isInstanceOf(MailInviteNotRespondableException.class);
    var ev = dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eventId)).fetchOne();
    assertThat(ev.getCancelledAt()).isNotNull();
  }

  /** 응답 전에 같은 SEQUENCE 취소 메일이 먼저 있어도 초대는 응답할 수 없다. */
  @Test
  void sameSequenceCancel_beforeAnyResponse_blocksRequest() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 먼저취소", ics("REQUEST", 0, "20261103T100000"));
    long cancel = deliverInvite(user, accountId, "취소: 먼저취소", ics("CANCEL", 0, "20261103T100000"));
    messageService.get(user, id, false);
    messageService.get(user, cancel, false);

    CalendarInvite req = inviteService.view(user, id);

    assertThat(req.outdated()).isTrue();
    assertThat(req.canRespond()).isFalse();
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.ICAL_UID.eq(UID))).isZero();
  }

  /** 같은 응답을 두 번(이중 클릭) — 일정 하나, 응답 메일 하나. */
  @Test
  void doubleAccept_createsOneEvent_andSendsOneReply() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 이중", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);

    CalendarInvite first = inviteService.respond(user, id, "ACCEPTED");
    greenMail.waitForIncomingEmail(2);
    CalendarInvite second = inviteService.respond(user, id, "ACCEPTED");

    assertThat(second.eventId()).isEqualTo(first.eventId());
    assertThat(second.myResponse()).isEqualTo("ACCEPTED");
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.ICAL_UID.eq(UID))).isEqualTo(1);
    assertThat(greenMail.waitForIncomingEmail(500, 3)).isFalse();
    assertThat(replies()).hasSize(1);
  }

  /**
   * 응답 메일이 나간 뒤 캘린더 반영이 실패해도 선점(내 응답)을 되돌리지 않는다 — 되돌리면 다시 누를 때 주최자에게 REPLY 가 두 번 간다(PR #962 리뷰).
   */
  @Test
  void recordFailsAfterReplySent_keepsClaim_andRetryDoesNotResend() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = newAccount(user);
    long id = deliverInvite(user, accountId, "초대: 반영 실패", ics("REQUEST", 0, "20261103T100000"));
    messageService.get(user, id, false);
    doThrow(new IllegalStateException("캘린더 반영 실패"))
        .doCallRealMethod()
        .when(calendarPort)
        .applyLocalResponse(anyLong(), anyString(), any(), anyString());

    assertThatThrownBy(() -> inviteService.respond(user, id, "ACCEPTED"))
        .isInstanceOf(IllegalStateException.class);
    greenMail.waitForIncomingEmail(2);
    assertThat(replies()).hasSize(1);

    CalendarInvite again = inviteService.respond(user, id, "ACCEPTED");
    assertThat(again.myResponse()).isEqualTo("ACCEPTED");
    assertThat(greenMail.waitForIncomingEmail(500, 3)).isFalse();
    assertThat(replies()).hasSize(1);
  }

  /** 같은 주인·UID 앱 일정은 하나 — 동시 수락으로 두 번째 넣기가 오면 넣지 않는다(V229 부분 유일 인덱스). */
  @Test
  void insertIfAbsent_secondInsertForSameUid_isSkipped() {
    long user = TestFixtures.createHuman(dsl);
    long calendarId = calendarService.ensureDefault(user);
    var v =
        new InviteEventValues(
            "회의",
            OffsetDateTime.parse("2026-11-03T10:00:00+09:00"),
            OffsetDateTime.parse("2026-11-03T11:00:00+09:00"),
            false,
            null,
            "dup-uid@x.com",
            0);

    assertThat(inviteEventRepo.insertIfAbsent(user, calendarId, v)).isPresent();
    assertThat(inviteEventRepo.insertIfAbsent(user, calendarId, v)).isEmpty();
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.ICAL_UID.eq("dup-uid@x.com")))
        .isEqualTo(1);
  }
}

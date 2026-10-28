package com.workplace.mail;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.service.CalendarService;
import com.workplace.mail.dto.CalendarInvite;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphBodyLoader.GraphMessageBody;
import com.workplace.mail.service.GraphBodyLoader.ItemBody;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.invite.MailInviteService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Properties;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-986 M365(Graph) 계정의 일정 초대 — eventMessage 본문 적재 때 원문 MIME($value)의 iCalendar 로 초대 기록, 응답은 Graph
 * 일정 응답(accept) + 동기화 사본의 내 응답 즉시 갱신. Graph 클라이언트·토큰은 목(ExternalClientMockedTestBase).
 */
@Transactional
class MailCalendarInviteGraphTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired MailMessageService messageService;
  @Autowired MailInviteService inviteService;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailFolderRepository folderRepo;
  @Autowired CalendarService calendarService;
  @Autowired GraphApiClient graphApiClient;
  @Autowired GraphCalendarClient graphCalendarClient;
  @Autowired GraphTokenService graphTokenService;

  static final String UID = "040000008200E00074C5B7101A82E008-wp986";

  /** Exchange 가 돌려주는 원문 MIME 모양(alternative: text/html + text/calendar METHOD:REQUEST). */
  static byte[] meetingMime() throws Exception {
    String ics =
        String.join(
            "\r\n",
            "BEGIN:VCALENDAR",
            "METHOD:REQUEST",
            "PRODID:Microsoft Exchange Server 2010",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            "ORGANIZER;CN=팀장:mailto:lead@corp.com",
            "ATTENDEE;PARTSTAT=NEEDS-ACTION;CN=별칭:mailto:alias@corp.com",
            "UID:" + UID,
            "SUMMARY;LANGUAGE=ko-KR:주간 점검",
            "DTSTART;TZID=Korea Standard Time:20261103T140000",
            "DTEND;TZID=Korea Standard Time:20261103T150000",
            "SEQUENCE:0",
            "END:VEVENT",
            "END:VCALENDAR",
            "");
    MimeMessage msg = new MimeMessage(Session.getInstance(new Properties()));
    msg.setFrom("lead@corp.com");
    msg.setRecipients(Message.RecipientType.TO, "alias@corp.com");
    msg.setSubject("주간 점검", "UTF-8");
    MimeBodyPart html = new MimeBodyPart();
    html.setContent("<p>초대</p>", "text/html; charset=UTF-8");
    MimeBodyPart cal = new MimeBodyPart();
    cal.setContent(ics, "text/calendar; charset=utf-8; method=REQUEST");
    MimeMultipart alt = new MimeMultipart("alternative");
    alt.addBodyPart(html);
    alt.addBodyPart(cal);
    msg.setContent(alt);
    msg.saveChanges();
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    msg.writeTo(out);
    return out.toByteArray();
  }

  private long seedGraphMessage(long accountId, String providerMessageId) {
    long folderId = folderRepo.ensureFolder(accountId, "INBOX").id();
    ParsedMessage m =
        new ParsedMessage(
            0L,
            "mid-" + providerMessageId + "@graph",
            "thread-" + providerMessageId,
            null,
            null,
            "lead@corp.com",
            "팀장",
            "alias@corp.com",
            null,
            "주간 점검",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            null,
            List.of());
    messageRepo.upsertByProviderId(accountId, folderId, m, providerMessageId, true);
    return messageRepo.findByProviderId(accountId, folderId, providerMessageId).orElseThrow();
  }

  /** 동기화된 M365 일정 사본(external_id 있음, 내 응답 NEEDS_ACTION). */
  private long seedSyncedEvent(long user) {
    long calId = calendarService.ensureDefault(user);
    long eventId =
        dsl.insertInto(CALENDAR_EVENT)
            .set(CALENDAR_EVENT.OWNER_ID, user)
            .set(CALENDAR_EVENT.CALENDAR_ID, calId)
            .set(CALENDAR_EVENT.TITLE, "주간 점검")
            .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-11-03T05:00:00Z"))
            .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-11-03T06:00:00Z"))
            .set(CALENDAR_EVENT.EXTERNAL_ID, "AAMk-graph-event")
            .set(CALENDAR_EVENT.ICAL_UID, UID)
            .returning(CALENDAR_EVENT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.EVENT_ID, eventId)
        .set(EVENT_ATTENDEE.USER_ID, user)
        .set(EVENT_ATTENDEE.ROLE, "ATTENDEE")
        .set(EVENT_ATTENDEE.RSVP_STATUS, "NEEDS_ACTION")
        .execute();
    return eventId;
  }

  private void stubMeetingMessage(String pid) throws Exception {
    when(graphTokenService.getAccessToken(
            org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn("T");
    when(graphApiClient.get(eq("T"), contains(pid + "?$select=body"), eq(GraphMessageBody.class)))
        .thenReturn(
            new GraphMessageBody(
                new ItemBody("html", "<p>초대</p>"),
                "초대",
                false,
                null,
                "#microsoft.graph.eventMessageRequest"));
    when(graphApiClient.getBytes(eq("T"), eq("/me/messages/" + pid + "/$value")))
        .thenReturn(meetingMime());
  }

  /** eventMessage → 원문 MIME 의 iCalendar 로 카드. 별칭으로 초대받아 참석자 목록에 계정 주소가 없어도 M365 는 응답할 수 있다. */
  @Test
  void meetingMessage_detailHasInvite_linkedToSyncedEvent() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long id = seedGraphMessage(accountId, "G-INV");
    long eventId = seedSyncedEvent(user);
    stubMeetingMessage("G-INV");

    CalendarInvite inv = messageService.get(user, id, false).calendarInvite();

    assertThat(inv).isNotNull();
    assertThat(inv.method()).isEqualTo("REQUEST");
    assertThat(inv.summary()).isEqualTo("주간 점검");
    assertThat(inv.start().toInstant()).isEqualTo(Instant.parse("2026-11-03T05:00:00Z"));
    assertThat(inv.eventId()).isEqualTo(eventId);
    assertThat(inv.myResponse()).isEqualTo("NEEDS_ACTION");
    assertThat(inv.canRespond()).isTrue();
  }

  /** 일반 Graph 메일은 원문을 받지 않고 카드도 없다. */
  @Test
  void normalMessage_noInvite_noMimeFetch() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long id = seedGraphMessage(accountId, "G-PLAIN");
    when(graphTokenService.getAccessToken(
            org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn("T");
    when(graphApiClient.get(eq("T"), contains("G-PLAIN?$select=body"), eq(GraphMessageBody.class)))
        .thenReturn(new GraphMessageBody(new ItemBody("html", "<p>hi</p>"), "hi", false));

    assertThat(messageService.get(user, id, false).calendarInvite()).isNull();
    verify(graphApiClient, never()).getBytes(anyString(), anyString());
  }

  /** 수락 → Graph accept(메일에 이어진 일정 id) + 동기화 사본의 내 응답 즉시 ACCEPTED. */
  @Test
  void accept_callsGraph_andUpdatesSyncedAttendee() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long id = seedGraphMessage(accountId, "G-ACC");
    long eventId = seedSyncedEvent(user);
    stubMeetingMessage("G-ACC");
    messageService.get(user, id, false);
    when(graphCalendarClient.findEventIdForMessage("T", "G-ACC"))
        .thenReturn(Optional.of("AAMk-graph-event"));

    CalendarInvite after = inviteService.respond(user, id, "ACCEPTED");

    verify(graphCalendarClient).respondToEvent("T", "AAMk-graph-event", "ACCEPTED");
    assertThat(after.myResponse()).isEqualTo("ACCEPTED");
    assertThat(after.eventId()).isEqualTo(eventId);
    assertThat(
            dsl.select(EVENT_ATTENDEE.RSVP_STATUS)
                .from(EVENT_ATTENDEE)
                .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
                .and(EVENT_ATTENDEE.USER_ID.eq(user))
                .fetchOne(EVENT_ATTENDEE.RSVP_STATUS))
        .isEqualTo("ACCEPTED");
    // M365 는 앱 일정을 새로 만들지 않는다(동기화 사본 하나뿐)
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.ICAL_UID.eq(UID))).isEqualTo(1);
  }

  /** 메일에 이어진 일정을 못 얻으면 UID 검색으로 찾는다. */
  @Test
  void decline_fallsBackToICalUidLookup() throws Exception {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.seedGraphAccount(dsl, user);
    long id = seedGraphMessage(accountId, "G-DEC");
    stubMeetingMessage("G-DEC");
    messageService.get(user, id, false);
    when(graphCalendarClient.findEventIdByICalUid("T", UID)).thenReturn(Optional.of("EV-BY-UID"));

    CalendarInvite after = inviteService.respond(user, id, "DECLINED");

    verify(graphCalendarClient).respondToEvent("T", "EV-BY-UID", "DECLINED");
    assertThat(after.myResponse()).isEqualTo("DECLINED");
    assertThat(after.eventId()).isNull();
  }
}

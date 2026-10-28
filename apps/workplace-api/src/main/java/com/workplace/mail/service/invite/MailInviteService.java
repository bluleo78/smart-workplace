package com.workplace.mail.service.invite;

import com.workplace.global.ical.IcsWriter;
import com.workplace.mail.dto.CalendarInvite;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailInviteNotFoundException;
import com.workplace.mail.exception.MailInviteNotRespondableException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.MailInviteCalendarPort;
import com.workplace.mail.outbound.MailInviteCalendarPort.InviteEventData;
import com.workplace.mail.outbound.MailInviteCalendarPort.MyInviteEvent;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailCalendarInviteRepository;
import com.workplace.mail.repository.EmailCalendarInviteRepository.InviteRow;
import com.workplace.mail.repository.EmailCalendarInviteRepository.InviteValues;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.MailMimeBuilder;
import com.workplace.mail.service.MailTransport;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 일정 초대 카드·응답(WP-986).
 *
 * <ul>
 *   <li>카드({@link #view}) — 본문 적재 때 기록한 초대에 내 캘린더 상태(같은 UID 일정·내 응답)와 옛 초대 판정(더 큰 SEQUENCE)을 합친다.
 *   <li>응답({@link #respond}) — M365 계정은 Graph 일정 응답(accept·tentativelyAccept·decline,
 *       sendResponse=true: Exchange 가 주최자에게 응답 메일을 보낸다) 뒤 동기화 사본의 내 응답을 즉시 고친다. IMAP 계정은 SMTP 로
 *       iCalendar METHOD:REPLY 메일을 주최자에게 보내고 내 기본 캘린더에 일정을 넣거나 고친다(거절은 새로 넣지 않음).
 * </ul>
 *
 * 네트워크 I/O(Graph·SMTP)는 트랜잭션 밖에서 하고, DB 읽기·쓰기는 짧은 트랜잭션(RLS GUC 주입)으로 감싼다(#232·#492).
 */
@Slf4j
@Service
public class MailInviteService {

  static final String NEEDS_ACTION = "NEEDS_ACTION";

  private final EmailCalendarInviteRepository inviteRepo;
  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;
  private final MailInviteCalendarPort calendarPort;
  private final GraphTokenService graphTokenService;
  private final GraphCalendarClient graphCalendarClient;
  private final MailMimeBuilder mimeBuilder;
  private final Map<MailProvider, MailTransport> transports;
  private final TransactionTemplate txTemplate;

  public MailInviteService(
      EmailCalendarInviteRepository inviteRepo,
      EmailAccountRepository accountRepo,
      EmailMessageRepository messageRepo,
      MailInviteCalendarPort calendarPort,
      GraphTokenService graphTokenService,
      GraphCalendarClient graphCalendarClient,
      MailMimeBuilder mimeBuilder,
      List<MailTransport> transports,
      PlatformTransactionManager txManager) {
    this.inviteRepo = inviteRepo;
    this.accountRepo = accountRepo;
    this.messageRepo = messageRepo;
    this.calendarPort = calendarPort;
    this.graphTokenService = graphTokenService;
    this.graphCalendarClient = graphCalendarClient;
    this.mimeBuilder = mimeBuilder;
    this.transports =
        transports.stream().collect(Collectors.toMap(MailTransport::provider, Function.identity()));
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 메일의 초대 카드 — 초대가 없는 메일(또는 남의 메일)이면 null. */
  public CalendarInvite view(long userId, long messageId) {
    return txTemplate.execute(
        s -> inviteRepo.findForUser(userId, messageId).map(r -> toView(userId, r)).orElse(null));
  }

  /**
   * 초대에 응답한다.
   *
   * @param response ACCEPTED·TENTATIVE·DECLINED
   * @return 응답을 반영한 카드
   * @throws EmailMessageNotFoundException 내 메일이 아님(404)
   * @throws MailInviteNotFoundException 초대가 없는 메일(404)
   * @throws MailInviteNotRespondableException 응답할 수 없는 초대(409)
   */
  public CalendarInvite respond(long userId, long messageId, String response) {
    Ctx ctx = txTemplate.execute(s -> loadRespondable(userId, messageId));
    InviteRow row = ctx.row();
    // 이 메일에서 이미 같은 응답을 보냈으면 다시 보내지 않는다(이중 클릭 — 응답 메일·일정이 두 번 생기지 않게) — 현재 카드만 돌려준다
    if (response.equals(row.myResponse())) {
      return view(userId, messageId);
    }
    // 응답 선점(비교 후 교체) — 동시에 들어온 같은 응답은 한쪽만 이겨 주최자에게 한 번만 보낸다
    String previous = row.myResponse();
    boolean claimed =
        Boolean.TRUE.equals(
            txTemplate.execute(s -> inviteRepo.claimResponse(messageId, previous, response)));
    if (!claimed) {
      return view(userId, messageId);
    }
    try {
      deliver(userId, ctx, response);
    } catch (RuntimeException e) {
      // 주최자에게 보내지 못했으면 선점을 되돌려 다시 시도할 수 있게 한다
      txTemplate.executeWithoutResult(
          s -> inviteRepo.releaseResponse(messageId, response, previous));
      throw e;
    }
    // 이미 주최자에게 나갔다 — 아래 반영이 실패해도 선점(내 응답)은 되돌리지 않는다. 되돌리면 다시 누를 때 응답이 두 번 간다.
    record(userId, messageId, ctx, response);
    return view(userId, messageId);
  }

  /** 선점한 응답을 주최자에게 보낸다(tx 밖) — M365 는 Graph 응답, IMAP 은 iCalendar REPLY 메일(SMTP). */
  private void deliver(long userId, Ctx ctx, String response) {
    InviteRow row = ctx.row();
    if (MailProvider.M365_GRAPH.name().equals(row.provider())) {
      // Exchange 가 주최자에게 응답 메일을 보내고 내 사서함 일정 상태를 바꾼다
      String token = graphTokenService.getAccessToken(userId, row.accountId());
      String graphEventId = resolveGraphEventId(token, row);
      graphCalendarClient.respondToEvent(token, graphEventId, response);
    } else {
      sendReply(userId, ctx.account(), row, response);
    }
  }

  /** 보낸 응답을 내 캘린더·초대 행에 반영한다(tx 안). */
  private void record(long userId, long messageId, Ctx ctx, String response) {
    InviteRow row = ctx.row();
    InviteValues v = row.values();
    txTemplate.executeWithoutResult(
        s -> {
          if (MailProvider.M365_GRAPH.name().equals(row.provider())) {
            // 동기화 사본의 내 응답을 바로 맞춘다(다음 동기화 전에도 화면이 맞게)
            calendarPort.applySyncedResponse(userId, v.uid(), response);
          } else {
            // 내 캘린더 반영 — 수락·미정은 넣거나 고치고, 거절은 있으면 응답만
            calendarPort.applyLocalResponse(userId, row.accountEmail(), eventData(v), response);
          }
          inviteRepo.updateMyResponse(messageId, response);
        });
  }

  /** 응답 전 확인 결과. */
  private record Ctx(InviteRow row, EmailAccountResponse account) {}

  /** 내 메일·초대·응답 가능 여부를 확인한다(tx 안). */
  private Ctx loadRespondable(long userId, long messageId) {
    Optional<InviteRow> row = inviteRepo.findForUser(userId, messageId);
    if (row.isEmpty()) {
      // 메일이 내 것이면 초대가 없는 것(404 초대 없음), 아니면 메일 자체를 숨긴다(404)
      if (messageRepo.findBodyTargetForUser(userId, messageId).isPresent()) {
        throw new MailInviteNotFoundException();
      }
      throw new EmailMessageNotFoundException(messageId);
    }
    InviteRow r = row.get();
    CalendarInvite view = toView(userId, r);
    if (!view.canRespond()) {
      throw new MailInviteNotRespondableException(notRespondableReason(view));
    }
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, r.accountId())
            .orElseThrow(() -> new EmailAccountNotFoundException(r.accountId()));
    return new Ctx(r, account);
  }

  private static String notRespondableReason(CalendarInvite view) {
    if ("CANCEL".equals(view.method())) return "취소된 일정에는 응답할 수 없어요";
    if (view.outdated()) return "이 초대는 이후 변경되었습니다 — 최신 메일에서 응답하세요";
    return "이 초대에는 메일에서 응답할 수 없어요";
  }

  /**
   * 초대 행 + 내 캘린더 상태 → 카드(tx 안). 낡음(outdated)·취소 판정은 이 초대와 같은 주최자의, 주최자가 직접 보낸(From·Sender) 메일과 일정만
   * 본다 — 다른 주소가 같은 UID 로 보낸 위조 초대·취소(ORGANIZER 에 주최자 주소를 적은 것 포함)가 진짜 초대를 막지 못하게. 주최자가 보내지 않은 더 새
   * 메일은 막지 않고 unverifiedNewer 로 알린다.
   */
  private CalendarInvite toView(long userId, InviteRow r) {
    InviteValues v = r.values();
    String organizer = v.organizerEmail();
    Optional<MyInviteEvent> found = calendarPort.findMyEvent(userId, v.uid());
    // 주최자가 다른 같은 UID 앱 일정 — 이 초대의 일정이 아니다(카드에 잇지 않고, 응답하면 남의 일정을 고치게 되므로 응답 불가)
    boolean foreignEvent = found.map(e -> e.local() && !sameOrganizer(e, organizer)).orElse(false);
    Optional<MyInviteEvent> event = foreignEvent ? Optional.empty() : found;
    int known = inviteRepo.maxSequenceForUser(userId, v.uid(), organizer).orElse(v.sequence());
    Integer eventSeq = event.map(MyInviteEvent::sequence).orElse(null);
    if (eventSeq != null) known = Math.max(known, eventSeq);
    boolean outdated = known > v.sequence();
    if ("REQUEST".equals(v.method()) && !outdated) {
      // 같은 SEQUENCE 이상의 취소(취소 메일 또는 취소 표시된 내 일정)가 있으면 이 초대는 끝났다 — 「이후 변경」으로 보이고 응답 불가
      boolean eventCancelled =
          event
              .map(e -> e.cancelled() && e.sequence() != null && e.sequence() >= v.sequence())
              .orElse(false);
      outdated =
          eventCancelled || inviteRepo.hasCancelAtOrAfter(userId, v.uid(), organizer, v.sequence());
    }
    // 주최자가 보내지 않은 더 새 초대·취소 — 응답은 막지 않고 카드에 「주최자에게 확인」을 띄운다(이미 낡은 초대면 의미 없음)
    boolean unverifiedNewer =
        "REQUEST".equals(v.method())
            && !outdated
            && inviteRepo.hasUnverifiedNewer(userId, v.uid(), organizer, v.sequence());
    String myResponse =
        event
            .map(MyInviteEvent::myResponse)
            .or(() -> Optional.ofNullable(r.myResponse()))
            .orElse(NEEDS_ACTION);
    boolean canRespond =
        "REQUEST".equals(v.method())
            && !outdated
            && !foreignEvent
            && organizer != null
            && !organizer.equalsIgnoreCase(r.accountEmail())
            && hasResponseChannel(r);
    return new CalendarInvite(
        v.method(),
        v.uid(),
        v.sequence(),
        v.summary(),
        v.startsAt(),
        v.endsAt(),
        v.allDay(),
        v.location(),
        organizer == null ? null : new CalendarInvite.Organizer(v.organizerName(), organizer),
        attendeeCount(v),
        myResponse,
        event.map(MyInviteEvent::eventId).orElse(null),
        outdated,
        canRespond,
        r.fromOrganizer(),
        unverifiedNewer);
  }

  /** 앱 일정의 주최자가 이 초대의 주최자와 같은가(대소문자 무시, 어느 쪽이든 없으면 다르다). */
  private static boolean sameOrganizer(MyInviteEvent e, String organizer) {
    return e.organizerEmail() != null
        && organizer != null
        && e.organizerEmail().equalsIgnoreCase(organizer);
  }

  /**
   * 응답 수단이 있는가. M365 는 Graph 메시지 id 가 있으면 된다 — 내 사서함 일정에 응답하므로 별칭·배포 목록으로 초대받아도 Exchange 가 나를 안다.
   * IMAP 은 REPLY 의 ATTENDEE 가 내 주소여야 주최자 쪽이 응답을 짝지으므로 참석자 목록에 내 계정 주소가 있어야 한다.
   */
  private static boolean hasResponseChannel(InviteRow r) {
    if (MailProvider.M365_GRAPH.name().equals(r.provider())) {
      return r.providerMessageId() != null;
    }
    String me = r.accountEmail() == null ? null : r.accountEmail().toLowerCase(Locale.ROOT);
    return me != null && r.values().attendeeEmails().contains(me);
  }

  /** 주최자를 포함한 서로 다른 참석자 수. */
  private static int attendeeCount(InviteValues v) {
    Set<String> people = new LinkedHashSet<>(v.attendeeEmails());
    if (v.organizerEmail() != null) people.add(v.organizerEmail().toLowerCase(Locale.ROOT));
    return people.size();
  }

  /** 메일에 이어진 Graph 일정 id — 메일의 event 탐색, 안 되면 UID 검색. 둘 다 없으면 응답할 수 없다(409). */
  private String resolveGraphEventId(String token, InviteRow row) {
    Optional<String> linked;
    try {
      linked = graphCalendarClient.findEventIdForMessage(token, row.providerMessageId());
    } catch (RuntimeException e) {
      // 메일의 event 탐색이 안 되면(권한·형식) UID 검색으로 넘어간다
      log.warn(
          "Graph 초대 메일의 일정 탐색 실패 — UID 검색으로 대신 (messageId={}): {}", row.messageId(), e.toString());
      linked = Optional.empty();
    }
    return linked
        .or(() -> graphCalendarClient.findEventIdByICalUid(token, row.values().uid()))
        .orElseThrow(
            () ->
                new MailInviteNotRespondableException(
                    "Outlook 캘린더에서 이 초대의 일정을 찾지 못했어요 — Outlook 에서 응답해 주세요"));
  }

  /** IMAP 계정: iCalendar METHOD:REPLY 메일을 주최자에게 SMTP 로 보낸다. 보낸편지함에는 남기지 않는다(응답은 일정 상태로 보인다). */
  private void sendReply(
      long userId, EmailAccountResponse account, InviteRow row, String response) {
    MailTransport transport = transports.get(MailProvider.IMAP);
    if (transport == null) {
      throw new MailSendException("메일 발송 경로가 없습니다");
    }
    InviteValues v = row.values();
    String messageId = UUID.randomUUID() + "@" + domainOf(account.emailAddress());
    Instant now = Instant.now();
    String summary = v.summary() == null ? "(제목 없음)" : v.summary();
    String who =
        account.displayName() == null || account.displayName().isBlank()
            ? account.emailAddress()
            : account.displayName();
    String parent = row.internetMessageId();
    OutgoingMail mail =
        new OutgoingMail(
            messageId,
            parent != null ? parent : messageId,
            account.emailAddress(),
            account.displayName(),
            List.of(v.organizerEmail()),
            List.of(),
            List.of(),
            subjectPrefix(response) + summary,
            who + " 님이 일정 초대에 「" + responseLabel(response) + "」(으)로 응답했습니다.\r\n\r\n" + summary,
            null,
            parent,
            parent == null ? null : "<" + parent + ">",
            null,
            now,
            List.of(),
            List.of());
    String ics = replyIcs(v, account, response, now);
    MimeMessage message;
    try {
      message = mimeBuilder.buildCalendarReply(account, mail, ics);
    } catch (MessagingException e) {
      throw new MailSendException("응답 메일 구성에 실패했습니다", e);
    }
    transport.transmit(userId, account, message, mail);
  }

  /**
   * iCalendar METHOD:REPLY 본문(RFC 5546 3.2.3) — 같은 UID·SEQUENCE 에 내 ATTENDEE 한 줄(PARTSTAT)만 싣는다. 반복
   * 일정이면 시리즈 전체 응답이다(RECURRENCE-ID 없음).
   */
  static String replyIcs(
      InviteValues v, EmailAccountResponse account, String response, Instant now) {
    IcsWriter w =
        new IcsWriter()
            .raw("BEGIN", "VCALENDAR")
            .raw("PRODID", "-//Gen:iA Works//Mail Invite Reply//KO")
            .raw("VERSION", "2.0")
            .raw("CALSCALE", "GREGORIAN")
            .raw("METHOD", "REPLY")
            .raw("BEGIN", "VEVENT")
            .raw("UID", v.uid())
            .raw("SEQUENCE", Integer.toString(v.sequence()))
            .utc("DTSTAMP", now);
    if (v.allDay()) {
      // 종일은 UTC 자정으로 저장한다 — UTC 기준 날짜가 원래 DATE 값이다
      w.date("DTSTART", v.startsAt().withOffsetSameInstant(ZoneOffset.UTC).toLocalDate());
      if (v.endsAt() != null) {
        w.date("DTEND", v.endsAt().withOffsetSameInstant(ZoneOffset.UTC).toLocalDate());
      }
    } else {
      w.utc("DTSTART", v.startsAt().toInstant());
      if (v.endsAt() != null) w.utc("DTEND", v.endsAt().toInstant());
    }
    return w.text("SUMMARY", v.summary())
        .person("ORGANIZER", v.organizerName(), v.organizerEmail(), null)
        .person("ATTENDEE", account.displayName(), account.emailAddress(), response)
        .raw("END", "VEVENT")
        .raw("END", "VCALENDAR")
        .build();
  }

  /** 응답 메일 제목 앞말(Outlook 의 「수락:」 형식). */
  private static String subjectPrefix(String response) {
    return responseLabel(response) + ": ";
  }

  private static String responseLabel(String response) {
    return switch (response) {
      case "ACCEPTED" -> "수락";
      case "TENTATIVE" -> "미정";
      case "DECLINED" -> "거절";
      default -> response;
    };
  }

  /** 계정 주소의 도메인(Message-ID 오른쪽) — 없으면 localhost. */
  private static String domainOf(String email) {
    int at = email == null ? -1 : email.lastIndexOf('@');
    return at < 0 ? "localhost" : email.substring(at + 1);
  }

  /** 초대 값 → 캘린더 반영 값. */
  private static InviteEventData eventData(InviteValues v) {
    return new InviteEventData(
        v.uid(),
        v.sequence(),
        v.summary(),
        v.startsAt(),
        v.endsAt(),
        v.allDay(),
        v.location(),
        v.organizerEmail(),
        v.organizerName(),
        v.attendeeEmails());
  }
}

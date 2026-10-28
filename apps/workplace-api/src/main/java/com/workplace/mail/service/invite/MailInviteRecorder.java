package com.workplace.mail.service.invite;

import com.workplace.global.ical.IcsInvite;
import com.workplace.global.ical.IcsInvite.Person;
import com.workplace.global.ical.IcsParser;
import com.workplace.mail.outbound.MailInviteCalendarPort;
import com.workplace.mail.repository.EmailCalendarInviteRepository;
import com.workplace.mail.repository.EmailCalendarInviteRepository.InviteValues;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 본문 적재 때 메일의 iCalendar 를 읽어 초대를 기록한다(WP-986). IMAP·Graph 본문 적재기가 같은 쓰기 트랜잭션 안에서 부른다.
 *
 * <p>METHOD:REQUEST(초대)와 METHOD:CANCEL(취소, 또는 VEVENT STATUS:CANCELLED)만 기록한다 — REPLY·PUBLISH 등은 카드가
 * 없다. 취소 메일이면 메일 초대로 넣어 둔 같은 UID 일정을 취소로 표시한다(M365 동기화 일정은 동기화가 처리) — 그 일정의 주최자와 같은 주소가 보낸 취소일 때만.
 *
 * <p>「주최자가 보낸 메일」(from_organizer)은 iCalendar ORGANIZER 주소가 메일 From 또는 Sender 주소와 같을 때다(대소문자 무시).
 * ORGANIZER 는 메일을 쓰는 누구나 적을 수 있어서 — 같은 미팅의 다른 참석자가 진짜 주최자 주소로 큰 SEQUENCE·취소를 실어 보낼 수 있다 — 낡음·취소 판정과
 * 내 일정 취소 반영은 주최자가 보낸 메일만 쓴다. 주최자가 보내지 않은 취소 메일도 기록(카드에 「확인해 주세요」로 표시)하지만 내 일정은 건드리지 않는다.
 *
 * <p>초대 기록은 부가 기능이라 본문 적재를 막으면 안 된다. 그래서 savepoint(PROPAGATION_NESTED) 안에서 기록하고, 실패하면 그 지점까지만 되돌린 뒤
 * 로그만 남긴다 — 바깥 트랜잭션(본문·첨부 기록)은 계속 커밋된다.
 */
@Slf4j
@Component
public class MailInviteRecorder {

  // V230 컬럼 상한 — 넘치면 INSERT 가 트랜잭션을 깨므로 미리 자른다
  private static final int UID_MAX = 500;
  private static final int TEXT_MAX = 500;
  private static final int EMAIL_MAX = 320;
  private static final int NAME_MAX = 255;

  /** 참석자 저장 상한 — 전사 공지형 초대가 수천 명을 실어도 행이 지나치게 커지지 않게. */
  private static final int ATTENDEES_MAX = 1000;

  private final EmailCalendarInviteRepository inviteRepo;
  private final MailInviteCalendarPort calendarPort;

  /** 바깥(본문 적재) 트랜잭션 안의 savepoint — 기록이 DB 오류로 깨져도 본문 적재는 이어 간다. */
  private final TransactionTemplate savepoint;

  public MailInviteRecorder(
      EmailCalendarInviteRepository inviteRepo,
      MailInviteCalendarPort calendarPort,
      PlatformTransactionManager txManager) {
    this.inviteRepo = inviteRepo;
    this.calendarPort = calendarPort;
    this.savepoint = new TransactionTemplate(txManager);
    this.savepoint.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  /**
   * iCalendar 원문을 읽어 초대면 기록한다. 초대가 아니거나 읽지 못하면 아무것도 하지 않는다. 기록 중 실패(DB 제약·값 범위 등)는 savepoint 까지
   * 되돌리고 로그만 남긴다 — 예외를 던지지 않는다.
   *
   * @param ics 메일의 iCalendar 원문(없으면 null)
   * @param senderEmails 메일 From·Sender 주소(소문자) — 주최자가 보낸 메일인지 판정한다. null·빈 목록이면 주최자가 보내지 않은 것으로 본다
   */
  public void record(long userId, long messageId, String ics, List<String> senderEmails) {
    if (ics == null) return;
    List<String> senders = senderEmails == null ? List.of() : senderEmails;
    try {
      savepoint.executeWithoutResult(s -> doRecord(userId, messageId, ics, senders));
    } catch (RuntimeException e) {
      // 메일 원문 내용은 남기지 않는다 — messageId 와 예외 요약만
      log.warn("일정 초대 기록 실패 — 초대 없이 본문만 적재 (messageId={}): {}", messageId, e.toString());
    }
  }

  /** 실제 기록(savepoint 안). */
  private void doRecord(long userId, long messageId, String ics, List<String> senders) {
    Optional<IcsInvite> parsed = IcsParser.parse(ics);
    if (parsed.isEmpty()) return;
    IcsInvite inv = parsed.get();
    String method = methodOf(inv);
    if (method == null || inv.uid().length() > UID_MAX) return;
    Person org = inv.organizer();
    List<String> attendees =
        inv.attendees().stream()
            .map(Person::email)
            .filter(e -> e.length() <= EMAIL_MAX)
            .limit(ATTENDEES_MAX)
            .toList();
    boolean fromOrganizer = isFromOrganizer(org, senders);
    inviteRepo.upsert(
        messageId,
        new InviteValues(
            method,
            inv.uid(),
            inv.sequence(),
            truncate(inv.summary(), TEXT_MAX),
            inv.start(),
            inv.end(),
            inv.allDay(),
            truncate(inv.location(), TEXT_MAX),
            org == null ? null : truncate(org.email(), EMAIL_MAX),
            org == null ? null : truncate(org.name(), NAME_MAX),
            attendees),
        fromOrganizer);
    if ("CANCEL".equals(method)) {
      // 주최자 없는 취소는 누가 보냈는지 알 수 없어 일정에 반영하지 않는다(위조 취소 방지 — 어댑터가 주최자 일치를 본다).
      // 주최자가 아닌 주소가 보낸 취소도 반영하지 않는다 — 다른 참석자가 주최자 주소를 적어 보낸 위조 취소가 내 일정을 지우지 못하게
      if (org == null || !fromOrganizer) {
        if (org != null) log.info("주최자가 보내지 않은 취소 메일 — 일정에 반영하지 않음 (messageId={})", messageId);
        return;
      }
      int n = calendarPort.cancelLocal(userId, inv.uid(), inv.sequence(), org.email());
      if (n > 0) log.info("초대 취소 메일로 일정 {}건 취소 표시 (messageId={})", n, messageId);
    }
  }

  /** 이 메일을 주최자가 보냈는가 — iCalendar ORGANIZER 주소가 From·Sender 주소 가운데 하나와 같다(대소문자 무시). */
  static boolean isFromOrganizer(Person org, List<String> senders) {
    if (org == null || org.email() == null || org.email().isBlank()) return false;
    String organizer = org.email().trim();
    return senders.stream().anyMatch(organizer::equalsIgnoreCase);
  }

  /** 기록할 METHOD — 취소면 CANCEL, 초대면 REQUEST, 그 밖은 null(기록 안 함). */
  static String methodOf(IcsInvite inv) {
    if ("CANCEL".equals(inv.method())) return "CANCEL";
    if ("REQUEST".equals(inv.method())) return inv.cancelled() ? "CANCEL" : "REQUEST";
    return null;
  }

  private static String truncate(String s, int max) {
    return s == null || s.length() <= max ? s : s.substring(0, max);
  }
}

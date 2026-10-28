package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CALENDAR_INVITE;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 메일(envelope)에 실린 일정 초대 저장소(WP-986, V230 email_calendar_invite). 본문 적재 때 기록하고, 상세·응답이 읽는다. 소유 확인은
 * 메일 계정의 user_id 로 한다(끊긴 계정 제외 — 상세 조회와 같은 규칙).
 */
@Repository
@RequiredArgsConstructor
public class EmailCalendarInviteRepository {

  private final DSLContext dsl;

  /** 저장할 초대 값(길이는 호출자가 컬럼 상한에 맞춘다). */
  public record InviteValues(
      String method,
      String uid,
      int sequence,
      String summary,
      OffsetDateTime startsAt,
      OffsetDateTime endsAt,
      boolean allDay,
      String location,
      String organizerEmail,
      String organizerName,
      List<String> attendeeEmails) {}

  /**
   * 내 메일의 초대 한 행 + 응답에 필요한 계정 정보.
   *
   * @param provider 메일 계정 공급자(IMAP·M365_GRAPH)
   * @param providerMessageId Graph 메시지 id(IMAP 은 null)
   * @param internetMessageId 메일의 Message-ID(꺾쇠 없음, 없으면 null) — 응답 메일의 In-Reply-To
   * @param myResponse 이 메일에서 마지막으로 보낸 내 응답(없으면 null)
   */
  public record InviteRow(
      long messageId,
      long accountId,
      String provider,
      String accountEmail,
      String providerMessageId,
      String internetMessageId,
      InviteValues values,
      String myResponse) {}

  /** 초대를 기록한다 — 같은 메일을 다시 적재하면 값만 덮어쓰고 내 응답은 둔다. */
  public void upsert(long messageId, InviteValues v) {
    String[] attendees = v.attendeeEmails().toArray(String[]::new);
    dsl.insertInto(EMAIL_CALENDAR_INVITE)
        .set(EMAIL_CALENDAR_INVITE.MESSAGE_ID, messageId)
        .set(EMAIL_CALENDAR_INVITE.METHOD, v.method())
        .set(EMAIL_CALENDAR_INVITE.UID, v.uid())
        .set(EMAIL_CALENDAR_INVITE.SEQUENCE, v.sequence())
        .set(EMAIL_CALENDAR_INVITE.SUMMARY, v.summary())
        .set(EMAIL_CALENDAR_INVITE.STARTS_AT, v.startsAt())
        .set(EMAIL_CALENDAR_INVITE.ENDS_AT, v.endsAt())
        .set(EMAIL_CALENDAR_INVITE.ALL_DAY, v.allDay())
        .set(EMAIL_CALENDAR_INVITE.LOCATION, v.location())
        .set(EMAIL_CALENDAR_INVITE.ORGANIZER_EMAIL, v.organizerEmail())
        .set(EMAIL_CALENDAR_INVITE.ORGANIZER_NAME, v.organizerName())
        .set(EMAIL_CALENDAR_INVITE.ATTENDEE_EMAILS, attendees)
        .onConflict(EMAIL_CALENDAR_INVITE.MESSAGE_ID)
        .doUpdate()
        .set(EMAIL_CALENDAR_INVITE.METHOD, v.method())
        .set(EMAIL_CALENDAR_INVITE.UID, v.uid())
        .set(EMAIL_CALENDAR_INVITE.SEQUENCE, v.sequence())
        .set(EMAIL_CALENDAR_INVITE.SUMMARY, v.summary())
        .set(EMAIL_CALENDAR_INVITE.STARTS_AT, v.startsAt())
        .set(EMAIL_CALENDAR_INVITE.ENDS_AT, v.endsAt())
        .set(EMAIL_CALENDAR_INVITE.ALL_DAY, v.allDay())
        .set(EMAIL_CALENDAR_INVITE.LOCATION, v.location())
        .set(EMAIL_CALENDAR_INVITE.ORGANIZER_EMAIL, v.organizerEmail())
        .set(EMAIL_CALENDAR_INVITE.ORGANIZER_NAME, v.organizerName())
        .set(EMAIL_CALENDAR_INVITE.ATTENDEE_EMAILS, attendees)
        .execute();
  }

  /** 내 메일의 초대(메일이 내 것이 아니거나 초대가 없으면 빈 값). */
  public Optional<InviteRow> findForUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_CALENDAR_INVITE.asterisk(),
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_MESSAGE.MESSAGE_ID,
            EMAIL_ACCOUNT.PROVIDER,
            EMAIL_ACCOUNT.EMAIL_ADDRESS)
        .from(EMAIL_CALENDAR_INVITE)
        .join(EMAIL_MESSAGE)
        .on(EMAIL_MESSAGE.ID.eq(EMAIL_CALENDAR_INVITE.MESSAGE_ID))
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .where(EMAIL_CALENDAR_INVITE.MESSAGE_ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r -> {
              String[] attendees = r.get(EMAIL_CALENDAR_INVITE.ATTENDEE_EMAILS);
              return new InviteRow(
                  r.get(EMAIL_CALENDAR_INVITE.MESSAGE_ID),
                  r.get(EMAIL_MESSAGE.ACCOUNT_ID),
                  r.get(EMAIL_ACCOUNT.PROVIDER),
                  r.get(EMAIL_ACCOUNT.EMAIL_ADDRESS),
                  r.get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID),
                  r.get(EMAIL_MESSAGE.MESSAGE_ID),
                  new InviteValues(
                      r.get(EMAIL_CALENDAR_INVITE.METHOD),
                      r.get(EMAIL_CALENDAR_INVITE.UID),
                      r.get(EMAIL_CALENDAR_INVITE.SEQUENCE),
                      r.get(EMAIL_CALENDAR_INVITE.SUMMARY),
                      r.get(EMAIL_CALENDAR_INVITE.STARTS_AT),
                      r.get(EMAIL_CALENDAR_INVITE.ENDS_AT),
                      Boolean.TRUE.equals(r.get(EMAIL_CALENDAR_INVITE.ALL_DAY)),
                      r.get(EMAIL_CALENDAR_INVITE.LOCATION),
                      r.get(EMAIL_CALENDAR_INVITE.ORGANIZER_EMAIL),
                      r.get(EMAIL_CALENDAR_INVITE.ORGANIZER_NAME),
                      attendees == null ? List.of() : List.of(attendees)),
                  r.get(EMAIL_CALENDAR_INVITE.MY_RESPONSE));
            });
  }

  /**
   * 내 메일들 가운데 같은 UID·같은 주최자 초대의 가장 큰 SEQUENCE(없으면 빈 값) — 옛 초대 판정. 끊긴 계정의 메일도 센다(이미 알게 된 사실). 주최자가
   * 다른 메일은 세지 않는다 — 남이 같은 UID 에 큰 SEQUENCE 를 실어 보낸 위조 초대가 진짜 초대를 낡게 만들지 못하게.
   *
   * @param organizerEmail 이 초대의 주최자(없으면 주최자 없는 초대끼리만 센다)
   */
  public Optional<Integer> maxSequenceForUser(long userId, String uid, String organizerEmail) {
    return Optional.ofNullable(
        dsl.select(DSL.max(EMAIL_CALENDAR_INVITE.SEQUENCE))
            .from(EMAIL_CALENDAR_INVITE)
            .join(EMAIL_MESSAGE)
            .on(EMAIL_MESSAGE.ID.eq(EMAIL_CALENDAR_INVITE.MESSAGE_ID))
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .where(EMAIL_CALENDAR_INVITE.UID.eq(uid))
            .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(sameOrganizer(organizerEmail))
            .fetchOne(0, Integer.class));
  }

  /**
   * 같은 UID·같은 주최자의 취소 메일(METHOD:CANCEL)이 이 SEQUENCE 이상으로 있는가 — 있으면 그 초대는 취소된 것이라 응답할 수 없다(같은
   * SEQUENCE 의 취소도 초대보다 우선, RFC 5546 3.2.5).
   */
  public boolean hasCancelAtOrAfter(long userId, String uid, String organizerEmail, int sequence) {
    return dsl.fetchExists(
        DSL.selectOne()
            .from(EMAIL_CALENDAR_INVITE)
            .join(EMAIL_MESSAGE)
            .on(EMAIL_MESSAGE.ID.eq(EMAIL_CALENDAR_INVITE.MESSAGE_ID))
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .where(EMAIL_CALENDAR_INVITE.UID.eq(uid))
            .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_CALENDAR_INVITE.METHOD.eq("CANCEL"))
            .and(EMAIL_CALENDAR_INVITE.SEQUENCE.ge(sequence))
            .and(sameOrganizer(organizerEmail)));
  }

  /** 주최자 같음 조건(대소문자 무시). 주최자가 없으면 주최자 없는 초대끼리만. */
  private static Condition sameOrganizer(String organizerEmail) {
    return organizerEmail == null
        ? EMAIL_CALENDAR_INVITE.ORGANIZER_EMAIL.isNull()
        : DSL.lower(EMAIL_CALENDAR_INVITE.ORGANIZER_EMAIL)
            .eq(organizerEmail.toLowerCase(Locale.ROOT));
  }

  /**
   * 응답 선점 — 이 메일의 내 응답이 아직 {@code expected} 일 때만 {@code response} 로 바꾼다(비교 후 교체). 같은 응답을 두 번 보내는
   * 요청(이중 클릭·동시 요청)이 있으면 한쪽만 이겨 응답 메일을 한 번만 보낸다.
   *
   * @return 선점했으면 true
   */
  public boolean claimResponse(long messageId, String expected, String response) {
    return dsl.update(EMAIL_CALENDAR_INVITE)
            .set(EMAIL_CALENDAR_INVITE.MY_RESPONSE, response)
            .where(EMAIL_CALENDAR_INVITE.MESSAGE_ID.eq(messageId))
            .and(EMAIL_CALENDAR_INVITE.MY_RESPONSE.isNotDistinctFrom(expected))
            .execute()
        > 0;
  }

  /** 선점 되돌리기 — 응답 전송이 실패하면 선점한 값이 그대로일 때만 이전 값으로 돌린다. */
  public void releaseResponse(long messageId, String claimed, String previous) {
    dsl.update(EMAIL_CALENDAR_INVITE)
        .set(EMAIL_CALENDAR_INVITE.MY_RESPONSE, previous)
        .where(EMAIL_CALENDAR_INVITE.MESSAGE_ID.eq(messageId))
        .and(EMAIL_CALENDAR_INVITE.MY_RESPONSE.eq(claimed))
        .execute();
  }

  /** 이 메일에서 보낸 내 응답을 기록한다. */
  public void updateMyResponse(long messageId, String response) {
    dsl.update(EMAIL_CALENDAR_INVITE)
        .set(EMAIL_CALENDAR_INVITE.MY_RESPONSE, response)
        .set(EMAIL_CALENDAR_INVITE.RESPONDED_AT, OffsetDateTime.now())
        .where(EMAIL_CALENDAR_INVITE.MESSAGE_ID.eq(messageId))
        .execute();
  }
}

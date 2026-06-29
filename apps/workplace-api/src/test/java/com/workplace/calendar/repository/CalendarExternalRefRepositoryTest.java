package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.global.security.EncryptionService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class CalendarExternalRefRepositoryTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventRepository eventRepo;
  @Autowired CalendarRepository calendarRepo;
  @Autowired EncryptionService encryption;

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ex_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U")
        .set(USER.EMAIL, t + "@e.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long account(long uid) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, uid)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, uid + "@iacloud.kr")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("AT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 외부 쓰기 캘린더 컨테이너(is_read_only=false) 삽입. */
  private long externalCalendar(long uid, long accId, String extId) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, uid)
        .set(CALENDAR.NAME, "업무")
        .set(CALENDAR.COLOR, "blue")
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 0)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, accId)
        .set(CALENDAR.EXTERNAL_ID, extId)
        .set(CALENDAR.IS_READ_ONLY, false)
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  private CalendarEventRequest req(Long calId) {
    OffsetDateTime s = OffsetDateTime.parse("2026-07-10T09:00:00Z");
    return new CalendarEventRequest(
        "회의", null, s, s.plusHours(1), false, null, null, null, null, null, calId);
  }

  @Test
  void insertWithExternalId_and_findExternalRef_roundtrip() {
    long uid = user();
    long accId = account(uid);
    long calId = externalCalendar(uid, accId, "gcal-x");

    long eventId = eventRepo.insertWithExternalId(uid, calId, req(calId), "ext-evt-1");

    var evRef = eventRepo.findExternalRef(eventId).orElseThrow();
    assertThat(evRef.eventExternalId()).isEqualTo("ext-evt-1");
    assertThat(evRef.externalAccountId()).isEqualTo(accId);
    assertThat(evRef.calendarReadOnly()).isFalse();

    var calRef = calendarRepo.findExternalRef(calId).orElseThrow();
    assertThat(calRef.externalAccountId()).isEqualTo(accId);
    assertThat(calRef.externalId()).isEqualTo("gcal-x");
    assertThat(calRef.readOnly()).isFalse();
  }

  @Test
  void findExternalRef_localCalendar_hasNullExternalAccount() {
    long uid = user();
    long calId = calendarRepo.insert(uid, "기본", "blue", true, 0);
    long eventId = eventRepo.insert(uid, calId, req(calId));
    var evRef = eventRepo.findExternalRef(eventId).orElseThrow();
    assertThat(evRef.eventExternalId()).isNull();
    assertThat(evRef.externalAccountId()).isNull();
  }
}

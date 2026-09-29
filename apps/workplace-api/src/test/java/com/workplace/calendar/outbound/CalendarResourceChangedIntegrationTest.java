package com.workplace.calendar.outbound;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.calendar.service.CalendarFetcher;
import com.workplace.calendar.service.CalendarService;
import com.workplace.calendar.service.CalendarSyncService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import com.workplace.support.ResourceChangedCapture.Captured;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-61 통합 — 캘린더 일정·참석자·RSVP·캘린더·외부 동기화 변경 → AFTER_COMMIT resource.changed 수신자 검증. AFTER_COMMIT 발화를
 * 위해 클래스에 @Transactional 을 붙이지 않는다.
 */
@Import(CalendarResourceChangedIntegrationTest.FakeFetcherConfig.class)
@DisplayName("캘린더 변경 → resource.changed fan-out 통합")
class CalendarResourceChangedIntegrationTest extends IntegrationTestBase {

  /** 동기화 경로 검증용 가짜 fetcher — 실제 Graph 호출 없이 IMAP 키로 등록한다(Graph fetcher 는 M365_GRAPH). */
  @TestConfiguration
  static class FakeFetcherConfig {
    @Bean
    CalendarFetcher fakeImapCalendarFetcher() {
      CalendarFetcher f = mock(CalendarFetcher.class);
      when(f.provider()).thenReturn(MailProvider.IMAP);
      when(f.sync(
              org.mockito.ArgumentMatchers.anyLong(),
              org.mockito.ArgumentMatchers.anyLong(),
              org.mockito.ArgumentMatchers.any()))
          .thenReturn(0);
      return f;
    }
  }

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService eventService;
  @Autowired CalendarService calendarService;
  @Autowired CalendarSyncService syncService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired com.workplace.global.security.EncryptionService encryption;

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-07-01T09:00:00Z");

  private final List<Long> userIds = new ArrayList<>();
  private final List<Long> accountIds = new ArrayList<>();
  private Long owner;
  private Long attendee;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = createHuman();
    attendee = createHuman();
  }

  @AfterEach
  void cleanup() {
    dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(accountIds)).execute();
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.in(userIds)).execute();
    dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.in(userIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
    accountIds.clear();
    userIds.clear();
    TenantContext.clear();
  }

  /** resource/op 조합의 resource.changed 를 캡처해 (수신자, payload) 를 돌려준다 — 공용 헬퍼 위임. */
  private Captured capture(String resource, String op) {
    return ResourceChangedCapture.capture(registry, resource, op);
  }

  private CalendarEventRequest req(List<Long> attendees) {
    return new CalendarEventRequest(
        "rc-evt", null, NOW, NOW.plusHours(1), false, null, null, null, null, attendees, null);
  }

  @Test
  @DisplayName("일정 생성은 소유자와 참석자에게")
  void create_withAttendee_reachesOwnerAndAttendee() {
    clearInvocations(registry);
    eventService.create(owner, req(List.of(attendee)));
    assertThat(capture("calendar-event", "created").recipients())
        .containsExactlyInAnyOrder(owner, attendee);
  }

  @Test
  @DisplayName("일정 삭제는 삭제 전에 수집한 참석자에게도")
  void delete_reachesAttendeesCollectedBeforeDelete() {
    long id = eventService.create(owner, req(List.of(attendee))).id();
    clearInvocations(registry);
    eventService.delete(owner, id, EditScope.ALL, null);
    assertThat(capture("calendar-event", "deleted").recipients()).contains(owner, attendee);
  }

  @Test
  @DisplayName("참석자 제거는 제거된 사용자에게도")
  void removeAttendee_reachesRemovedUser() {
    long id = eventService.create(owner, req(List.of(attendee))).id();
    clearInvocations(registry);
    eventService.removeAttendee(owner, id, attendee);
    assertThat(capture("calendar-event", "updated").recipients()).contains(owner, attendee);
  }

  @Test
  @DisplayName("RSVP 응답은 소유자에게")
  void rsvp_reachesOwner() {
    long id = eventService.create(owner, req(List.of(attendee))).id();
    clearInvocations(registry);
    eventService.respondRsvp(attendee, id, "ACCEPTED");
    assertThat(capture("calendar-event", "updated").recipients()).contains(owner);
  }

  @Test
  @DisplayName("캘린더 초기화는 삭제 전에 수집한 내부 참석자에게도")
  void resetEvents_reachesAttendee() {
    long calId = calendarService.list(owner).get(0).id();
    eventService.create(owner, req(List.of(attendee)));
    clearInvocations(registry);
    calendarService.resetEvents(owner, calId);
    assertThat(capture("calendar", "updated").recipients()).contains(owner, attendee);
  }

  @Test
  @DisplayName("캘린더 생성은 소유자에게만")
  void calendarCreate_ownerOnly() {
    clearInvocations(registry);
    calendarService.create(owner, new CalendarRequest("rc-cal", "blue", null));
    assertThat(capture("calendar", "created").recipients()).containsExactly(owner);
  }

  @Test
  @DisplayName("외부 동기화 완료는 계정 소유자에게만, actor 없이")
  void sync_publishesOwnerOnly_withoutActor() {
    long accId = insertAccount(owner);
    accountIds.add(accId);
    clearInvocations(registry);
    syncService.sync(owner, accId);
    var c = capture("calendar", "updated");
    assertThat(c.recipients()).containsExactly(owner);
    assertThat(c.payload().get("actorId")).isNull();
  }

  private long insertAccount(long userId) {
    EmailAccountRequest r =
        new EmailAccountRequest(
            "cal@test.local",
            "rc-계정",
            "127.0.0.1",
            993,
            MailSecurity.SSL_TLS,
            "cal@test.local",
            "127.0.0.1",
            587,
            MailSecurity.STARTTLS,
            "cal@test.local",
            "pw",
            false);
    return accountRepo.insert(userId, r, encryption.encrypt("pw"));
  }

  /** 테넌트#1 ACTIVE 멤버 HUMAN 1명 — 공용 픽스처로 만들고 정리 목록에 넣는다. */
  private Long createHuman() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(id);
    return id;
  }
}

package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.calendar.repository.CalendarEventExceptionRepository;
import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.calendar.repository.EventReminderRepository.DueReminder;
import com.workplace.calendar.repository.EventReminderRepository.Rearm;
import com.workplace.global.tenant.TenantScopedRunner;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.context.ApplicationEventPublisher;

/** CalendarReminderScheduler — due 1건당 이벤트 발행 + 회차별 재무장(#705). Spring 컨텍스트 없이 직접 호출. */
class CalendarReminderSchedulerTest {

  private EventReminderRepository repo;
  private CalendarEventExceptionRepository exceptionRepo;
  private RecurrenceExpander expander;
  private ApplicationEventPublisher publisher;
  private TenantScopedRunner runner;
  private CalendarReminderScheduler scheduler;

  @BeforeEach
  void setUp() {
    repo = Mockito.mock(EventReminderRepository.class);
    exceptionRepo = Mockito.mock(CalendarEventExceptionRepository.class);
    expander = new RecurrenceExpander();
    publisher = Mockito.mock(ApplicationEventPublisher.class);
    runner = Mockito.mock(TenantScopedRunner.class);
    // forEachActiveTenant 가 단일 활성 테넌트(id=1)에 대해 콜백을 1회 실행하도록 스텁 — pollForCurrentTenant 본체 검증.
    Mockito.doAnswer(
            inv -> {
              inv.<Consumer<Long>>getArgument(0).accept(1L);
              return null;
            })
        .when(runner)
        .forEachActiveTenant(Mockito.any());
    scheduler = new CalendarReminderScheduler(repo, exceptionRepo, expander, publisher, runner);
    when(exceptionRepo.occurrencesByEvent(Mockito.any())).thenReturn(Map.of());
  }

  @Test
  void poll_publishesPerDue_andRearmsSingleEventsToNull() {
    OffsetDateTime now = OffsetDateTime.now();
    when(repo.findDue())
        .thenReturn(
            List.of(
                new DueReminder(100L, 10L, 1L, now.minusMinutes(1), 10, now.plusMinutes(9), null),
                new DueReminder(200L, 20L, 2L, now.minusMinutes(1), 10, now.plusMinutes(9), null)));

    scheduler.poll();

    var events = ArgumentCaptor.forClass(CalendarReminderDueEvent.class);
    verify(publisher, Mockito.times(2)).publishEvent(events.capture());
    assertThat(events.getAllValues())
        .extracting(CalendarReminderDueEvent::eventId)
        .containsExactly(10L, 20L);
    assertThat(events.getAllValues())
        .extracting(CalendarReminderDueEvent::ownerId)
        .containsExactly(1L, 2L);

    var rearmed = ArgumentCaptor.forClass(List.class);
    verify(repo).rearm(rearmed.capture());
    @SuppressWarnings("unchecked")
    List<Rearm> rearms = (List<Rearm>) rearmed.getValue();
    // 단발 일정(recurrenceRule=null) → 더 이상 발화 없음(null)으로 재무장.
    assertThat(rearms).extracting(Rearm::reminderId).containsExactly(100L, 200L);
    assertThat(rearms).extracting(Rearm::nextFireAt).containsExactly((OffsetDateTime) null, null);
  }

  @Test
  void poll_recurringEvent_rearmsToNextOccurrence() {
    OffsetDateTime masterStart = OffsetDateTime.now().minusDays(7);
    OffsetDateTime firedFireAt = OffsetDateTime.now().minusMinutes(1);
    when(repo.findDue())
        .thenReturn(
            List.of(new DueReminder(100L, 10L, 1L, firedFireAt, 10, masterStart, "FREQ=WEEKLY")));
    when(exceptionRepo.occurrencesByEvent(Mockito.any())).thenReturn(Map.of(10L, Set.of()));

    scheduler.poll();

    var rearmed = ArgumentCaptor.forClass(List.class);
    verify(repo).rearm(rearmed.capture());
    @SuppressWarnings("unchecked")
    List<Rearm> rearms = (List<Rearm>) rearmed.getValue();
    assertThat(rearms).hasSize(1);
    // 방금 발화한 회차(firedFireAt + 10분) 이후 다음 주 회차로 재무장 — null 이 아니고 미래 시각.
    assertThat(rearms.get(0).nextFireAt()).isNotNull();
    assertThat(rearms.get(0).nextFireAt()).isAfter(firedFireAt);
  }

  @Test
  void poll_noDue_publishesNothing_andSkipsRearm() {
    when(repo.findDue()).thenReturn(List.of());

    scheduler.poll();

    verify(publisher, never()).publishEvent(Mockito.any());
    verify(repo, never()).rearm(Mockito.any());
  }
}

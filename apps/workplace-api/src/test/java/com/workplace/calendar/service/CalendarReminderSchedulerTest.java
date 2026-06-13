package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.calendar.repository.EventReminderRepository.DueReminder;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.context.ApplicationEventPublisher;

/** CalendarReminderScheduler — due 1건당 이벤트 발행 + fired 마킹. Spring 컨텍스트 없이 직접 호출. */
class CalendarReminderSchedulerTest {

  private EventReminderRepository repo;
  private ApplicationEventPublisher publisher;
  private TenantScopedRunner runner;
  private CalendarReminderScheduler scheduler;

  @BeforeEach
  void setUp() {
    repo = Mockito.mock(EventReminderRepository.class);
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
    scheduler = new CalendarReminderScheduler(repo, publisher, runner);
  }

  @Test
  void poll_publishesPerDue_andMarksFired() {
    when(repo.findDue())
        .thenReturn(List.of(new DueReminder(100L, 10L, 1L), new DueReminder(200L, 20L, 2L)));

    scheduler.poll();

    var events = ArgumentCaptor.forClass(CalendarReminderDueEvent.class);
    verify(publisher, Mockito.times(2)).publishEvent(events.capture());
    assertThat(events.getAllValues())
        .extracting(CalendarReminderDueEvent::eventId)
        .containsExactly(10L, 20L);
    assertThat(events.getAllValues())
        .extracting(CalendarReminderDueEvent::ownerId)
        .containsExactly(1L, 2L);

    var fired = ArgumentCaptor.forClass(List.class);
    verify(repo).markFired(fired.capture());
    assertThat(fired.getValue()).containsExactly(100L, 200L);
  }

  @Test
  void poll_noDue_publishesNothing_andSkipsMark() {
    when(repo.findDue()).thenReturn(List.of());

    scheduler.poll();

    verify(publisher, never()).publishEvent(Mockito.any());
    verify(repo, never()).markFired(Mockito.any());
  }
}

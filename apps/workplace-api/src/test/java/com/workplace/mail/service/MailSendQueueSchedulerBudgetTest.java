package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.tenant.repository.TenantRepository;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

/**
 * 보낼 대기열 회차 시간 예산(WP-1786 코드 리뷰) — 첨부 메일은 SMTP 타임아웃이 2분이라 20건을 차례로 보내면 회차가 10분을 넘어 잠금이 풀리고, 다른 파드의
 * 멈춤 정리가 아직 보내지 않은 행을 「보냈는지 확인하지 못함」으로 돌렸다. 상수 관계(예산 + 행 하나 &lt; 잠금 최대 시간 &lt; 멈춤 기준)와, 예산이 지나면 남은
 * 잡은 행을 보내지 않고 대기로 되돌리는 동작을 스프링 없이(목·가짜 시계) 본다.
 */
class MailSendQueueSchedulerBudgetTest {

  @Test
  void 예산과_행_하나의_최대_전송_시간을_더해도_잠금_최대_시간보다_짧고_잠금은_멈춤_기준보다_짧다() throws Exception {
    Duration lock = Duration.parse(MailSendQueueScheduler.LOCK_AT_MOST_FOR);
    Duration longestPoll =
        MailSendQueueScheduler.SEND_BUDGET.plus(MailSendQueueScheduler.MAX_ROW_SEND);

    assertThat(longestPoll).isLessThan(lock);
    assertThat(lock).isLessThan(MailSendQueueScheduler.STUCK_AFTER);
    // 행 하나의 가정이 첨부 SMTP 타임아웃(쓰기·최종 응답 각 2분)을 덮는다.
    assertThat(MailSendQueueScheduler.MAX_ROW_SEND)
        .isGreaterThanOrEqualTo(Duration.ofMillis(2L * SmtpMailTransport.ATTACHMENT_IO_TIMEOUT_MS));
    // 애너테이션이 실제로 그 상수를 쓴다.
    SchedulerLock ann =
        MailSendQueueScheduler.class.getMethod("poll").getAnnotation(SchedulerLock.class);
    assertThat(ann.lockAtMostFor()).isEqualTo(MailSendQueueScheduler.LOCK_AT_MOST_FOR);
  }

  /** 목 의존성 — runForTenant 는 콜백을 그대로 부르고, 부른 테넌트를 tenant 에 남긴다(잡기가 어느 테넌트였는지 가리게). */
  private record Fixture(
      MailSendQueueScheduler scheduler,
      MailDraftRepository repo,
      MailQueuedSender sender,
      AtomicLong clock,
      AtomicLong tenant) {}

  @SuppressWarnings("unchecked")
  private static Fixture fixture(List<Long> tenants) {
    TenantRepository tenantRepo = mock(TenantRepository.class);
    when(tenantRepo.findActiveTenantIds()).thenReturn(tenants);
    TenantScopedRunner runner = mock(TenantScopedRunner.class);
    AtomicLong tenant = new AtomicLong();
    doAnswer(
            inv -> {
              tenant.set(inv.getArgument(0));
              ((Consumer<Long>) inv.getArgument(1)).accept(inv.getArgument(0));
              return null;
            })
        .when(runner)
        .runForTenant(anyLong(), any());
    MailDraftRepository repo = mock(MailDraftRepository.class);
    MailQueuedSender sender = mock(MailQueuedSender.class);
    MailSendQueueScheduler s =
        new MailSendQueueScheduler(
            tenantRepo,
            runner,
            repo,
            sender,
            mock(ApplicationEventPublisher.class),
            Duration.ofMinutes(1));
    AtomicLong clock = new AtomicLong(1_000L);
    s.useClock(clock::get);
    return new Fixture(s, repo, sender, clock, tenant);
  }

  @Test
  void 예산이_지나면_남은_잡은_행은_보내지_않고_대기로_되돌린다() {
    Fixture f = fixture(List.of(1L));
    when(f.repo().claimDue(anyInt())).thenReturn(List.of(11L, 12L, 13L, 14L));
    // 행 하나에 90초 — 두 번째 행이 끝나면(180초) 예산(2분)이 지난다.
    List<Long> sent = new ArrayList<>();
    doAnswer(
            inv -> {
              sent.add(inv.getArgument(0));
              f.clock().addAndGet(Duration.ofSeconds(90).toNanos());
              return null;
            })
        .when(f.sender())
        .sendOne(anyLong());

    f.scheduler().poll();

    assertThat(sent).containsExactly(11L, 12L);
    verify(f.repo()).releaseClaimed(List.of(13L, 14L));
  }

  @Test
  void 예산_안에_다_보내면_되돌릴_행이_없다() {
    Fixture f = fixture(List.of(1L));
    when(f.repo().claimDue(anyInt())).thenReturn(List.of(21L, 22L));
    doAnswer(
            inv -> {
              f.clock().addAndGet(Duration.ofSeconds(10).toNanos());
              return null;
            })
        .when(f.sender())
        .sendOne(anyLong());

    f.scheduler().poll();

    verify(f.sender()).sendOne(21L);
    verify(f.sender()).sendOne(22L);
    verify(f.repo(), never()).releaseClaimed(any());
  }

  @Test
  void 앞_테넌트가_예산을_다_쓰면_다음_테넌트는_잡지_않는다() {
    Fixture f = fixture(List.of(1L, 2L));
    // 첫 테넌트에서만 행을 잡고(두 번째 잡기는 일어나지 않아야 한다) 그 행이 예산을 다 쓴다.
    when(f.repo().claimDue(anyInt())).thenReturn(List.of(31L)).thenReturn(List.of(41L));
    doAnswer(
            inv -> {
              f.clock().addAndGet(MailSendQueueScheduler.SEND_BUDGET.toNanos());
              return null;
            })
        .when(f.sender())
        .sendOne(anyLong());

    f.scheduler().poll();

    verify(f.sender()).sendOne(31L);
    verify(f.sender(), never()).sendOne(41L);
    verify(f.repo()).claimDue(anyInt());
  }

  @Test
  void 앞_테넌트가_예산을_다_써_잡지_못한_뒤_테넌트는_다음_회차에_먼저_돈다() {
    Fixture f = fixture(List.of(1L, 2L, 3L));
    // 잡기가 어느 테넌트에서 일어났는지 runForTenant 가 넘긴 테넌트로 가린다 — 테넌트 1 은 늘 예산을 다 쓰는 행이 있다.
    when(f.repo().claimDue(anyInt())).thenAnswer(inv -> List.of(f.tenant().get() * 100 + 1));
    List<Long> sent = new ArrayList<>();
    doAnswer(
            inv -> {
              Long id = inv.getArgument(0);
              sent.add(id);
              // 테넌트 1 의 행만 예산을 다 쓴다.
              if (id == 101L) {
                f.clock().addAndGet(MailSendQueueScheduler.SEND_BUDGET.toNanos());
              }
              return null;
            })
        .when(f.sender())
        .sendOne(anyLong());

    f.scheduler().poll(); // 1 이 예산을 다 써 2·3 은 잡지 못한다.
    f.scheduler().poll(); // 2 부터 — 2·3 이 보낸 뒤 1 이 다시 예산을 쓴다.

    assertThat(sent).containsExactly(101L, 201L, 301L, 101L);
  }

  @Test
  void 테넌트_순서는_시작_테넌트부터_돌고_빠뜨리지_않는다() {
    List<Long> ids = List.of(1L, 3L, 5L);
    assertThat(MailSendQueueScheduler.rotateFrom(ids, null)).containsExactly(1L, 3L, 5L);
    assertThat(MailSendQueueScheduler.rotateFrom(ids, 3L)).containsExactly(3L, 5L, 1L);
    // 그 사이 비활성이 된 테넌트면 그보다 큰 첫 테넌트부터, 가장 큰 ID 보다 크면 처음부터.
    assertThat(MailSendQueueScheduler.rotateFrom(ids, 4L)).containsExactly(5L, 1L, 3L);
    assertThat(MailSendQueueScheduler.rotateFrom(ids, 9L)).containsExactly(1L, 3L, 5L);
  }
}

package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.mail.outbound.MailSendFailedEvent;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.repository.MailDraftRepository.StuckRow;
import com.workplace.tenant.repository.TenantRepository;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 보낼 대기열 폴러(WP-1786). 5초마다(앞 회차가 끝난 뒤부터 — 겹치지 않음) 활성 테넌트마다 두 단계로 돈다.
 *
 * <ol>
 *   <li>짧은 테넌트 트랜잭션({@link TenantScopedRunner#runForTenant}) — 멈춤 정리 차례({@link #sweepInterval}, 기본
 *       1분)인 회차에만 10분 넘게 SENDING 에 멈춘 행을 FAILED·UNKNOWN 으로 돌리고(실제로 나갔는지 몰라 다시 보내지 않는다 — 중복 발송 방지)
 *       「보냈는지 확인하지 못함」 알림을 같은 트랜잭션에 넣는다. 이어 별도 트랜잭션에서 시각이 된 대기 행을 최대 {@link #BATCH} 건 FOR UPDATE
 *       SKIP LOCKED 로 SENDING 으로 잡는다 — 한쪽 실패가 다른 쪽을 막지 않게 나눈다.
 *   <li>커밋 뒤 트랜잭션 밖 — 그 테넌트의 TenantContext 를 세운 채 잡은 행마다 {@link MailQueuedSender#sendOne}. 전송(외부
 *       I/O)이 행 잠금·DB 커넥션을 붙잡지 않게 하려고 잡기와 나눈다.
 * </ol>
 *
 * <p>파드 여럿이면 ShedLock 이 회차를 하나로 묶고, 잠금이 풀린 틈에 겹쳐도 SKIP LOCKED + QUEUED→SENDING 상태 전환이 한 행을 한 곳만 잡게
 * 한다. 한 테넌트의 실패는 경고 로그만 남기고 다음 테넌트로 넘어간다. 테스트 프로필은 스케줄링이 꺼져(workplace.scheduling.enabled=false)
 * 테스트가 {@link #poll()} 을 직접 부른다.
 *
 * <p>알림은 다른 도메인처럼 이벤트({@link MailSendFailedEvent})로 알림 도메인에 넘긴다(메일이 notify 를 직접 import 하지 않는다). 다만
 * 그 리스너는 AFTER_COMMIT 이 아니라 동기 {@code @EventListener} 라 멈춘 행을 FAILED 로 돌리는 트랜잭션 안에서 알림 insert 까지
 * 끝난다 — 상태만 바뀌고 알림이 빠지는(또는 그 반대) 경우가 없다.
 *
 * <p>멈춤 시계: 잡기가 회차의 행을 한꺼번에 sending_started_at 으로 찍고, {@link MailQueuedSender#sendOne} 이 행마다 전송 직전에
 * 다시 찍는다 — 차례를 기다리던 행이 앞 행들의 전송 시간 때문에 멈춘 것으로 오인되지 않게.
 */
@Slf4j
@Component
public class MailSendQueueScheduler {

  /** 이보다 오래 SENDING 이면 프로세스가 발송 중에 멈춘 것으로 본다. */
  static final Duration STUCK_AFTER = Duration.ofMinutes(10);

  /** 한 회차에 테넌트당 잡는 최대 행 수 — 5초 회차 안에 보낼 만큼만 잡아 나머지는 다음 회차로. */
  static final int BATCH = 20;

  private final TenantRepository tenantRepository;
  private final TenantScopedRunner tenantRunner;
  private final MailDraftRepository draftRepo;
  private final MailQueuedSender sender;
  private final ApplicationEventPublisher publisher;

  /**
   * 멈춤 정리 간격 — 10분 기준을 보는 일이라 5초 회차마다 할 필요가 없어 기본 1분에 한 번만 한다(잡기는 회차마다). 테스트 프로필은 0 으로 두어 poll 마다
   * 정리한다.
   */
  private final Duration sweepInterval;

  /**
   * 마지막으로 멈춤 정리를 한 회차 시각(System.nanoTime) — 아직 안 했으면 null. 이 파드 안에서만 센다(ShedLock 이 회차를 하나로 묶는다).
   */
  private Long lastSweepNanos;

  public MailSendQueueScheduler(
      TenantRepository tenantRepository,
      TenantScopedRunner tenantRunner,
      MailDraftRepository draftRepo,
      MailQueuedSender sender,
      ApplicationEventPublisher publisher,
      @Value("${workplace.mail.send-queue.stuck-sweep-interval:PT1M}") Duration sweepInterval) {
    this.tenantRepository = tenantRepository;
    this.tenantRunner = tenantRunner;
    this.draftRepo = draftRepo;
    this.sender = sender;
    this.publisher = publisher;
    this.sweepInterval = sweepInterval;
  }

  /** 5초 폴링 — 활성 테넌트마다 멈춤 정리(차례일 때만)·잡기(트랜잭션 안) 뒤 발송(트랜잭션 밖). */
  @Scheduled(fixedDelay = 5_000)
  @SchedulerLock(
      name = "MailSendQueueScheduler.poll",
      lockAtMostFor = "PT10M",
      lockAtLeastFor = "PT2S")
  public void poll() {
    // 이 회차가 멈춤 정리 차례인지 한 번 정해 모든 테넌트에 같게 쓴다.
    boolean sweep = takeSweepTurn(System.nanoTime());
    for (Long tenantId : tenantRepository.findActiveTenantIds()) {
      try {
        pollTenant(tenantId, sweep);
      } catch (RuntimeException e) {
        log.warn("[mail-queue] 테넌트 {} 대기열 처리 실패 — 건너뛰고 계속", tenantId, e);
      }
    }
  }

  /**
   * 한 테넌트 — 멈춤 정리와 잡기를 서로 다른 트랜잭션에서 한다(최종 리뷰 T4-M3). 한 트랜잭션이면 멈춘 행 알림 insert 가 계속 실패할 때 잡기까지 매 회차
   * 롤백돼 그 테넌트 메일이 QUEUED 에 영영 남는다. 각 단계 실패는 경고 로그만 남기고 다른 단계는 그대로 돈다. 잡기는 커밋까지 끝낸 뒤에 보낸다(커밋 전에 보내면
   * 롤백 시 SENDING 표시 없이 메일만 나간다).
   */
  private void pollTenant(long tenantId, boolean sweep) {
    // ① 멈춤 정리(차례일 때만) — 상태 전환과 그 알림은 여전히 한 트랜잭션(상태만 바뀌고 알림이 빠지지 않게).
    if (sweep) {
      sweepStuck(tenantId);
    }
    // ② 잡기 — 멈춤 정리가 실패해도 시각이 된 대기 행은 보낸다. 실패하면 poll 이 경고를 남기고 다음 테넌트로 넘어간다.
    List<Long> claimed = new ArrayList<>();
    tenantRunner.runForTenant(tenantId, t -> claimed.addAll(draftRepo.claimDue(BATCH)));
    if (claimed.isEmpty()) {
      return;
    }
    // runForTenant 가 끝나며 컨텍스트를 비웠으므로 발송 동안 다시 세운다 — send 가 여는 트랜잭션마다 이 테넌트 GUC 가 주입된다.
    TenantContext.set(tenantId);
    try {
      for (Long id : claimed) {
        try {
          sender.sendOne(id);
        } catch (RuntimeException e) {
          // sendOne 은 실패를 스스로 기록하지만, 그마저 새면 나머지 행까지 막지 않는다(이 행은 10분 뒤 멈춤 정리가 맡는다).
          log.warn("[mail-queue] 대기 메일 발송 처리 실패 tenant={} draftId={}", tenantId, id, e);
        }
      }
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * 한 테넌트의 멈춤 정리 — 10분 넘게 SENDING 에 멈춘 행을 FAILED·UNKNOWN 으로 돌리고 그 알림을 같은 트랜잭션에 넣는다. 잡기와 다른 트랜잭션이라
   * 실패해도 경고 로그만 남기고 잡기는 계속한다.
   */
  private void sweepStuck(long tenantId) {
    try {
      tenantRunner.runForTenant(
          tenantId,
          t -> {
            for (StuckRow s : draftRepo.failStuck(STUCK_AFTER)) {
              log.warn("[mail-queue] 발송 중 멈춘 행을 실패로 돌림 tenant={} draftId={}", t, s.id());
              // 동기 리스너가 이 트랜잭션 안에서 알림을 만든다 — 실패하면 상태 전환도 함께 롤백된다.
              publisher.publishEvent(
                  new MailSendFailedEvent(s.userId(), s.id(), s.subject(), true));
            }
          });
    } catch (RuntimeException e) {
      log.warn("[mail-queue] 테넌트 {} 멈춘 행 정리 실패 — 잡기는 계속", tenantId, e);
    }
  }

  /**
   * 이 회차가 멈춤 정리 차례인가 — 처음이거나 마지막 정리에서 {@link #sweepInterval} 이 지났으면 차례로 잡고(시각을 남긴다) true. 회차는 겹치지
   * 않지만(fixedDelay) 테스트가 poll 을 여러 스레드에서 부를 수 있어 synchronized 로 둔다.
   *
   * @param nowNanos 지금(System.nanoTime) — 테스트가 시각을 넘길 수 있게 인자로 받는다
   */
  synchronized boolean takeSweepTurn(long nowNanos) {
    if (lastSweepNanos != null && nowNanos - lastSweepNanos < sweepInterval.toNanos()) {
      return false;
    }
    lastSweepNanos = nowNanos;
    return true;
  }
}

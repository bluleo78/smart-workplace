package com.workplace.mail.service;

import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Job;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정당 수동 동기화 진행 상태 + 동시 실행 가드. DB({@code mail_account_job}, Kind.SYNC)에 보관하므로 파드가 여러 대여도 가드·진행률이
 * 공유되고 재기동에도 남는다(WP-1977). 비정상 종료로 RUNNING 이 남아도 {@link #TTL} 이 지나면 만료로 보아 IDLE 취급·재시작을 허용한다.
 *
 * <p>{@link #tryStart} 가 돌려주는 실행 핸들({@link MailJobRun})을 호출자(동기화·본문 보충)가 들고 다니며 진행 쓰기·끝내기에 넘긴다 —
 * 쓰기는 그 핸들의 실행 토큰으로 한정돼, 같은 파드에서든 다른 파드에서든 만료 뒤 다시 선점된 새 실행을 옛 실행이 덮어쓰지 못한다. 살아 있는 실행은 전용
 * 하트비트({@link MailJobHeartbeat}, 30초)가 updated_at 을 갱신하므로 TTL 을 짧게(2분) 둬도 오래 걸리는 동기화를 빼앗기지 않고, 파드가
 * 죽으면 최대 TTL 뒤 다른 파드가 이어받는다.
 *
 * <p>선점·하트비트 등록·테넌트 처리·best-effort 쓰기는 공통 골격({@link MailJobTracker})이 한다. 진행
 * 쓰기(startBodies·incBody·finish)는 실패해도 동기화를 깨지 않고, tryStart/snapshot 은 가드가 실제 값을 필요로 하므로 엄격하다.
 *
 * <p>본문 진행(incBody)은 1건마다 트랜잭션을 열지 않고 실행 핸들별로 메모리에 쌓았다가 {@link #BODY_FLUSH_COUNT}건 또는 {@link
 * #BODY_FLUSH_INTERVAL} 이 지나면 한 번에 더해 쓴다(첫 건은 진행이 바로 보이게 즉시). 남은 건수는 finish 때 마지막으로 쓴다.
 *
 * <p>배포 전환 주의: DB 가드로 바꾼 버전으로 처음 롤링 배포하는 동안 한 번은 같은 계정 동기화가 두 파드에서 겹칠 수 있다(옛 파드는 메모리 가드) — 자세한 것은
 * {@link MailJobTracker} 클래스 주석.
 */
@Component
public class MailSyncProgress {

  /** RUNNING 이 이 시간 동안 갱신(진행 쓰기·하트비트)이 없으면 만료(죽은 작업)로 본다. 하트비트 주기(30초)보다 넉넉히 길게 둔다. */
  static final Duration TTL = Duration.ofMinutes(2);

  /** 본문 진행을 이 건수만큼 쌓이면 한 번에 쓴다. */
  static final int BODY_FLUSH_COUNT = 20;

  /** 마지막으로 쓴 뒤 이 시간이 지나면 쌓인 건수가 적어도 다음 incBody 때 쓴다 — 진행률이 너무 늦게 보이지 않게. */
  static final Duration BODY_FLUSH_INTERVAL = Duration.ofSeconds(2);

  private final MailAccountJobRepository repo;
  private final MailJobTracker jobs;

  /** 경과 시간 측정용 시계(나노초) — 테스트는 고정 시계를 넣어 시간 조건을 결정적으로 만든다. */
  private final LongSupplier nanoClock;

  /** 실행 핸들별 아직 쓰지 않은 본문 진행 — 핸들(토큰 포함)로 나눠 다른 실행의 건수와 섞이지 않게 한다. */
  private final Map<MailJobRun, PendingBodies> pending = new ConcurrentHashMap<>();

  /**
   * 한 실행의 쌓인 본문 건수와 마지막으로 쓴 시각(아직 안 썼으면 null — 첫 건은 바로 쓴다). total·seen 은 마지막 건을 알아보려고 둔다 — 마지막 건이
   * finish 까지 미뤄지면 진행바가 total 에 닿지 못한 채 사라진다.
   */
  private static final class PendingBodies {
    /** startBodies 가 알려 준 보충 대상 수(모르면 -1). */
    final int total;

    /** 지금까지 받은 incBody 수(쓴 것 포함). */
    int seen;

    int count;
    Long lastFlushNanos;

    PendingBodies(int total) {
      this.total = total;
    }
  }

  /** 스프링 주입용 — 다른 메일 서비스처럼 테넌트 인식 트랜잭션 매니저로 짧은 트랜잭션 템플릿을 만든다. */
  @Autowired
  public MailSyncProgress(
      MailAccountJobRepository repo,
      PlatformTransactionManager txManager,
      MailJobHeartbeat heartbeat) {
    this(repo, new TransactionTemplate(txManager), heartbeat);
  }

  /** 템플릿 직접 지정(테스트용). */
  public MailSyncProgress(
      MailAccountJobRepository repo, TransactionTemplate txTemplate, MailJobHeartbeat heartbeat) {
    this(repo, txTemplate, heartbeat, System::nanoTime);
  }

  /** 템플릿·시계 직접 지정(테스트용) — 본문 진행 묶음 쓰기의 시간 조건을 결정적으로 검증할 때 쓴다. */
  public MailSyncProgress(
      MailAccountJobRepository repo,
      TransactionTemplate txTemplate,
      MailJobHeartbeat heartbeat,
      LongSupplier nanoClock) {
    this.repo = repo;
    this.jobs = new MailJobTracker(Kind.SYNC, "메일 동기화 진행", TTL, repo, txTemplate, heartbeat);
    this.nanoClock = nanoClock;
  }

  /**
   * 동기화 시작 시도. 이미 진행 중(만료 전)이면 empty(가드). 성공 시 RUNNING, phase=LIST 로 리셋하고 실행 핸들을 하트비트에 넣어 돌려준다 —
   * 호출자는 이 핸들로 진행 쓰기·끝내기를 한다.
   */
  public Optional<MailJobRun> tryStart(long accountId) {
    return jobs.tryStart(accountId, "LIST");
  }

  /** 목록 단계 완료 → 본문 보충 단계 진입(total = 보충 대상 수, done 은 0 으로 리셋). */
  public void startBodies(MailJobRun run, int total) {
    if (run != null) {
      // done 을 0 으로 되돌리므로 이전 단계에서 쌓인(쓰지 않은) 본문 진행은 버리고, 마지막 건을 알아보게 total 을 기억해 새로 시작한다.
      pending.put(run, new PendingBodies(total));
    }
    jobs.write(
        run,
        "startBodies",
        () -> repo.setPhaseTotal(Kind.SYNC, run.accountId(), run.runId(), "BODIES", total));
  }

  /**
   * 본문 1건 적재 완료 — 실행 핸들별로 메모리에 쌓고, 첫 건이거나 마지막 건(total 도달)이거나 {@link #BODY_FLUSH_COUNT}건이 쌓였거나 마지막
   * 쓰기 뒤 {@link #BODY_FLUSH_INTERVAL} 이 지났으면 쌓인 만큼 한 번에 더해 쓴다. 1건마다 트랜잭션을 열던 것을 줄이려는 것이다(WP-1977 리뷰
   * 후속).
   */
  public void incBody(MailJobRun run) {
    if (run == null) {
      return; // 쓸 실행이 없다(선점하지 않은 보충) — 쌓지도 않는다.
    }
    PendingBodies p = pending.computeIfAbsent(run, r -> new PendingBodies(-1));
    int delta;
    synchronized (p) {
      p.count++;
      p.seen++;
      long now = nanoClock.getAsLong();
      boolean due =
          p.lastFlushNanos == null
              || p.seen == p.total
              || p.count >= BODY_FLUSH_COUNT
              || now - p.lastFlushNanos >= BODY_FLUSH_INTERVAL.toNanos();
      if (!due) {
        return;
      }
      delta = p.count;
      p.count = 0;
      p.lastFlushNanos = now;
    }
    writeDone(run, delta);
  }

  /** 쌓인 본문 진행 delta 건을 더해 쓴다(best-effort — 실패해도 동기화를 깨지 않는다). */
  private void writeDone(MailJobRun run, int delta) {
    jobs.write(run, "incBody", () -> repo.addDone(Kind.SYNC, run.accountId(), run.runId(), delta));
  }

  /** 이 실행의 쌓인 본문 진행을 꺼내 비운다(마지막 쓰기용) — 없으면 0. */
  private int drainPending(MailJobRun run) {
    PendingBodies p = pending.remove(run);
    if (p == null) {
      return 0;
    }
    synchronized (p) {
      int n = p.count;
      p.count = 0;
      return n;
    }
  }

  /** 동기화/보충 종료 → DONE(스냅샷상 IDLE, running=false). 먼저 하트비트에서 빼고 쓴다(쓰기가 실패해도 TTL 뒤 만료되게). */
  public void finish(MailJobRun run) {
    if (run != null) {
      // 쌓아 둔 본문 진행을 먼저 쓴다 — 끝난 뒤(DONE)에는 RUNNING 조건 때문에 더할 수 없다. 이 쓰기가 실패해도 끝내기는 따로 시도한다.
      int rest = drainPending(run);
      if (rest > 0) {
        writeDone(run, rest);
      }
    }
    jobs.end(run, "finish", () -> repo.finish(Kind.SYNC, run.accountId(), run.runId()));
  }

  /**
   * 테스트 정리 전용 — 계정의 동기화 진행 행을 실행 토큰과 상관없이 지운다(목킹된 보충이 끝내지 못한 진행을 지울 때). 살아 있는 동기화의 가드를 풀어 버리므로 운영
   * 코드에서 부르면 안 된다.
   */
  public void discardForTest(long accountId) {
    pending.keySet().removeIf(r -> r.accountId() == accountId);
    jobs.discardForTest(accountId);
  }

  /** 현재 상태 스냅샷. 행 없음·만료·종료(DONE/FAILED)는 IDLE(종료 시 total/done 유지, 행 없음은 0/0). */
  public MailSyncStatus snapshot(long accountId) {
    Job job = jobs.find(accountId).orElse(null);
    if (job == null) {
      return new MailSyncStatus("IDLE", 0, 0, false);
    }
    int total = job.total() == null ? 0 : job.total();
    boolean running = "RUNNING".equals(job.state()) && !job.expired();
    return new MailSyncStatus(running ? job.phase() : "IDLE", total, job.done(), running);
  }
}

package com.workplace.fileai.security;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * HTML 보안 점검 재개 스케줄러(WP-1262). 3분마다 남은 PENDING·lease 만료 CHECKING 을 다시 점검한다 — 커밋 뒤 비동기 점검이 실패했거나 큐가
 * 넘쳤거나 프로세스가 중간에 내려간 경우의 백스톱이다.
 *
 * <p>FileExtractionScheduler 의 2단계를 따른다. ① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션에서 대상만
 * 모으고(RLS), ② 각 파일을 전용 실행기({@code fileSecurityCheckExecutor})에 넘긴다 — 파이프라인이 스스로 짧은 트랜잭션을 열어 LLM 호출이
 * DB 커넥션을 오래 쥐지 않고(#232), 스케줄 스레드가 테넌트당 최대 {@value #BATCH}건 LLM 호출을 순차로 기다리다 ShedLock 기간을 넘기지 않는다.
 * 실행기 큐가 차 있으면 그 회차 제출을 멈춘다(남은 행은 PENDING 이라 다음 회차에 줍는다). 겹친 제출은 선점 CAS 가 한 번만 돌린다.
 */
@Slf4j
@Component
public class FileSecurityCheckScheduler {

  /** 테넌트당 회차 상한. */
  static final int BATCH = 50;

  /** 수집 단계 산출 — 어느 테넌트의 어느 파일인지. */
  private record TenantFile(long tenantId, long fileId) {}

  private final TenantScopedRunner tenantRunner;
  private final FileSecurityCheckRepository repo;
  private final FileSecurityCheckPipeline pipeline;
  private final AssistantResolver assistantResolver;
  private final ThreadPoolTaskExecutor executor;

  public FileSecurityCheckScheduler(
      TenantScopedRunner tenantRunner,
      FileSecurityCheckRepository repo,
      FileSecurityCheckPipeline pipeline,
      AssistantResolver assistantResolver,
      @Qualifier(FileSecurityCheckExecutorConfig.EXECUTOR) ThreadPoolTaskExecutor executor) {
    this.tenantRunner = tenantRunner;
    this.repo = repo;
    this.pipeline = pipeline;
    this.assistantResolver = assistantResolver;
    this.executor = executor;
  }

  /** 3분 주기 재개. */
  @Scheduled(fixedRate = 180_000)
  @SchedulerLock(name = "FileSecurityCheckScheduler.runOnce")
  public void runOnce() {
    // ① 수집 — AI 없는 테넌트는 건너뛴다(파이프라인이 어차피 NO_AI 로 손대지 않는다).
    List<TenantFile> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          List<Long> resumable = repo.findResumable(BATCH);
          if (resumable.isEmpty() || assistantResolver.resolveWorkspaceOrEmpty().isEmpty()) return;
          for (long fileId : resumable) {
            targets.add(new TenantFile(tenantId, fileId));
          }
        });

    // ② 파일별 점검을 실행기에 제출 — 제출 시점의 TenantContext 를 TenantContextTaskDecorator 가 워커로 옮긴다.
    int submitted = 0;
    for (TenantFile t : targets) {
      if (queueFull()) {
        log.info(
            "보안 점검 실행기 큐가 차 있어 이번 회차 제출 중단 — {}건 제출, {}건은 다음 회차",
            submitted,
            targets.size() - submitted);
        return;
      }
      TenantContext.set(t.tenantId());
      try {
        executor.execute(() -> checkQuietly(t));
        submitted++;
      } finally {
        TenantContext.clear();
      }
    }
  }

  /** 실행기 큐에 자리가 없는지 — 거부 핸들러는 조용히 버리므로 제출 전에 직접 본다. */
  private boolean queueFull() {
    return executor.getThreadPoolExecutor().getQueue().remainingCapacity() == 0;
  }

  /** 한 파일 점검 — 실패해도 행이 PENDING 으로 남아 다음 회차에 다시 줍는다. */
  private void checkQuietly(TenantFile t) {
    try {
      pipeline.check(t.fileId());
    } catch (RuntimeException e) {
      log.warn("보안 점검 재개 실패 tenant={} fileId={} — 다음 주기에 재시도", t.tenantId(), t.fileId(), e);
    }
  }
}

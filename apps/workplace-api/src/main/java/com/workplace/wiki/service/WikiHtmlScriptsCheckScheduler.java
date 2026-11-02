package com.workplace.wiki.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.fileai.security.FileSecurityCheckExecutorConfig;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.wiki.repository.WikiHtmlScriptsCheckRepository;
import com.workplace.wiki.repository.WikiHtmlScriptsCheckRepository.Key;
import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * 노트 HTML 블록 보안 점검 재개 스케줄러(WP-1290). 3분마다 남은 PENDING·lease 만료 CHECKING 을 다시 점검한다 — 커밋 뒤 비동기 점검이
 * 실패했거나 큐가 넘쳤거나 프로세스가 중간에 내려간 경우의 백스톱이다. 파일 점검 스케줄러({@code FileSecurityCheckScheduler})와 같은 2단계: ①
 * 테넌트별 짧은 트랜잭션에서 대상만 모으고(RLS) ② 각 행을 같은 전용 실행기에 넘긴다. 실행기 큐가 차 있으면 그 회차 제출을 멈춘다(남은 행은 다음 회차).
 */
@Slf4j
@Component
public class WikiHtmlScriptsCheckScheduler {

  /** 테넌트당 회차 상한. */
  static final int BATCH = 50;

  /** 수집 단계 산출 — 어느 테넌트의 어느 행인지. */
  private record TenantKey(long tenantId, Key key) {}

  private final TenantScopedRunner tenantRunner;
  private final WikiHtmlScriptsCheckRepository repo;
  private final WikiHtmlScriptsCheckPipeline pipeline;
  private final AssistantResolver assistantResolver;
  private final ThreadPoolTaskExecutor executor;

  public WikiHtmlScriptsCheckScheduler(
      TenantScopedRunner tenantRunner,
      WikiHtmlScriptsCheckRepository repo,
      WikiHtmlScriptsCheckPipeline pipeline,
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
  @SchedulerLock(name = "WikiHtmlScriptsCheckScheduler.runOnce")
  public void runOnce() {
    // ① 수집 — AI 없는 테넌트는 건너뛴다(파이프라인이 어차피 NO_AI 로 손대지 않는다).
    List<TenantKey> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          List<Key> resumable = repo.findResumable(BATCH);
          if (resumable.isEmpty() || assistantResolver.resolveWorkspaceOrEmpty().isEmpty()) return;
          for (Key key : resumable) {
            targets.add(new TenantKey(tenantId, key));
          }
        });

    // ② 행별 점검을 실행기에 제출 — 제출 시점의 TenantContext 를 TenantContextTaskDecorator 가 워커로 옮긴다.
    int submitted = 0;
    for (TenantKey t : targets) {
      if (queueFull()) {
        log.info(
            "보안 점검 실행기 큐가 차 있어 노트 HTML 점검 제출 중단 — {}건 제출, {}건은 다음 회차",
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

  /** 한 행 점검 — 실패해도 행이 PENDING 으로 남아 다음 회차에 다시 줍는다. */
  private void checkQuietly(TenantKey t) {
    try {
      pipeline.check(t.key().pageId(), t.key().hash());
    } catch (RuntimeException e) {
      log.warn(
          "노트 HTML 보안 점검 재개 실패 tenant={} pageId={} — 다음 주기에 재시도",
          t.tenantId(),
          t.key().pageId(),
          e);
    }
  }
}

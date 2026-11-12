package com.workplace.issue.overview.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.util.Texts;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.ProjectStatusAiRequest;
import com.workplace.issue.outbound.dto.ProjectStatusAiResult;
import com.workplace.issue.overview.ProjectOverviewResponse;
import com.workplace.issue.overview.ProjectOverviewService;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프로젝트 상태 AI 요약 한 회(WP-1479) — 실행권을 잡고, 개요를 계산해 배지·입력을 만들고, 입력이 바뀌었을 때만 AI 에게 글을 받아 저장한다.
 *
 * <p>흐름:
 *
 * <ol>
 *   <li>tx1: 실행권 잡기(claim) — next_run_at 을 지금 + 간격으로 민다. 못 잡으면 {@link Outcome#SKIPPED}. 따로 커밋해 두어 뒤
 *       단계가 실패해도 다음 회차(간격 뒤)에 다시 시도한다.
 *   <li>tx2: 개요 계산 → 배지·입력. 요약할 것이 없으면 옛 요약을 지우고(카드가 숨는다) {@link Outcome#SKIPPED_EMPTY}. 지난 입력과 해시가
 *       같으면 checked_at 만 갱신하고 {@link Outcome#UNCHANGED}. 공통 비서가 없으면 {@link Outcome#SKIPPED}(이전 요약
 *       유지).
 *   <li>tx 밖: AI 호출 — 커넥션을 붙잡지 않는다. 실패·빈 글이면 {@link Outcome#FAILED}(이전 요약 유지).
 *   <li>tx3: 글을 다듬어(trim, 400 코드 포인트) 배지·해시와 함께 저장 → {@link Outcome#GENERATED}.
 * </ol>
 *
 * <p>프로젝트 행은 refresh 에서 한 번 읽어 tx1·tx2 에 넘긴다(삭제된 프로젝트면 실행권을 잡지 않고 {@link Outcome#SKIPPED}).
 *
 * <p>호출자가 TenantContext 를 세운다(스케줄러). 트랜잭션은 {@link TransactionTemplate} 으로 연다 — 단계마다 경계를 나눠야 해서.
 */
@Slf4j
@Service
public class ProjectStatusSummaryService {

  /** 저장하는 요약 글 최대 길이(코드 포인트) — ai-agent 의 PROJECT_STATUS_SUMMARY_MAX 와 같은 기준(코드 포인트)으로 센다. */
  static final int SUMMARY_MAX = 400;

  private final ProjectStatusSummaryRepository repository;
  private final ProjectRepository projectRepository;
  private final ProjectOverviewService overviewService;
  private final AssistantResolver assistantResolver;
  private final AiAgentIssueClient client;
  private final TransactionTemplate txTemplate;

  public ProjectStatusSummaryService(
      ProjectStatusSummaryRepository repository,
      ProjectRepository projectRepository,
      ProjectOverviewService overviewService,
      AssistantResolver assistantResolver,
      AiAgentIssueClient client,
      PlatformTransactionManager txManager) {
    this.repository = repository;
    this.projectRepository = projectRepository;
    this.overviewService = overviewService;
    this.assistantResolver = assistantResolver;
    this.client = client;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 한 회의 결과 — 스케줄러가 회차 로그에 센다. */
  public enum Outcome {
    /** AI 가 새 요약을 썼고 저장했다. */
    GENERATED,
    /** 입력이 그대로라 AI 없이 점검 시각만 넘겼다. */
    UNCHANGED,
    /**
     * 건너뜀 — 실행권을 잡지 못했거나(아직 때가 아니거나 다른 인스턴스가 잡음, 또는 프로젝트가 없음), 워크스페이스 공통 비서가 없어 AI 를 부르지 않았다(실패가
     * 아니라 설정 상태라 이전 요약 유지). 스케줄러가 한 칸으로 센다.
     */
    SKIPPED,
    /** 요약할 이슈가 없어 AI 를 부르지 않았다 — 옛 요약이 있으면 지워 조용해진 프로젝트에 지난 글이 남지 않게 한다. */
    SKIPPED_EMPTY,
    /** AI 실패·빈 글 — 이전 요약을 유지한다. 다음 회차(간격 뒤)에 다시 시도한다. */
    FAILED
  }

  /** tx2 의 결과 — AI 를 불러야 하면 request 가 있고, 그 전에 끝났으면 done 이 있다. */
  private record Prepared(Outcome done, ProjectStatusAiRequest request, String hash) {

    static Prepared done(Outcome outcome) {
      return new Prepared(outcome, null, null);
    }
  }

  /**
   * 프로젝트 하나의 상태 요약을 점검한다.
   *
   * @param projectId 대상 프로젝트
   * @param now 「지금」 — 점유·점검·생성 시각과 개요의 오늘을 정한다
   */
  public Outcome refresh(long projectId, OffsetDateTime now) {
    // 프로젝트는 한 번만 읽어 실행권 잡기(간격)와 개요 계산에 함께 쓴다 — 두 단계가 같은 행을 따로 읽지 않게.
    Optional<ProjectRow> found = txTemplate.execute(s -> projectRepository.findById(projectId));
    if (found == null || found.isEmpty()) return Outcome.SKIPPED;
    ProjectRow project = found.get();

    Boolean claimed = txTemplate.execute(s -> claim(project, now));
    if (!Boolean.TRUE.equals(claimed)) return Outcome.SKIPPED;

    Prepared prepared = txTemplate.execute(s -> prepare(project, now));
    if (prepared.done() != null) return prepared.done();

    // tx 밖 — AI HTTP 는 커넥션을 붙잡지 않는다. 실패하면 이전 요약을 그대로 둔다(next_run_at 은 claim 이 이미 밀었다).
    ProjectStatusAiResult result;
    try {
      result = client.summarizeProjectStatus(prepared.request());
    } catch (RuntimeException e) {
      log.warn("프로젝트 상태 요약 AI 실패 projectId={}: {}", projectId, e.toString());
      return Outcome.FAILED;
    }
    String summary = result == null || result.summary() == null ? "" : result.summary().trim();
    if (summary.isEmpty()) {
      log.warn("프로젝트 상태 요약 AI 가 빈 글을 반환 projectId={}", projectId);
      return Outcome.FAILED;
    }
    // ai-agent 와 같은 코드 포인트 기준으로 자른다 — 서로게이트 쌍(이모지 등)을 가르지 않는다.
    String text = Texts.headCodePoints(summary, SUMMARY_MAX);
    String badge = prepared.request().badge();
    txTemplate.executeWithoutResult(
        s -> repository.saveGenerated(projectId, badge, text, prepared.hash(), now));
    return Outcome.GENERATED;
  }

  /** tx1 — 프로젝트 간격(모르는 값이면 기본 H2)으로 다음 점검 시각을 정하고 실행권을 잡는다. */
  private boolean claim(ProjectRow project, OffsetDateTime now) {
    StatusSummaryInterval interval = StatusSummaryInterval.parse(project.statusSummaryInterval());
    return repository.claim(project.id(), now, now.plus(interval.duration()));
  }

  /** tx2 — 개요 계산 → 배지·입력·해시. AI 를 부르지 않고 끝나는 경우를 여기서 정리한다. */
  private Prepared prepare(ProjectRow project, OffsetDateTime now) {
    long projectId = project.id();

    ProjectOverviewResponse overview = overviewService.computeWithoutAccessCheck(project, now);
    StatusBadge badge = ProjectStatusRule.badge(overview.progress(), overview.today());
    ProjectStatusInputs inputs = ProjectStatusInputs.from(overview, badge);
    if (inputs.isEmpty()) {
      // 이슈가 다 닫히고 최근 활동도 없어진 프로젝트 — 지난 요약(「열린 이슈 N건」 등)이 사실과 어긋나므로 지우고 점검 시각만 남긴다.
      repository.clearSummary(projectId, now);
      return Prepared.done(Outcome.SKIPPED_EMPTY);
    }

    String hash = inputs.hash();
    Optional<StatusSummaryRow> row = repository.find(projectId);
    if (row.isPresent() && row.get().summary() != null && hash.equals(row.get().inputHash())) {
      repository.touchChecked(projectId, now);
      return Prepared.done(Outcome.UNCHANGED);
    }

    Optional<AssistantSpec> spec = assistantResolver.resolveWorkspaceOrEmpty();
    if (spec.isEmpty()) {
      log.debug("공통 비서가 없어 프로젝트 상태 요약을 건너뜀 projectId={}", projectId);
      return Prepared.done(Outcome.SKIPPED);
    }
    AssistantSpec s = spec.get();
    return new Prepared(
        null,
        new ProjectStatusAiRequest(
            project.name(),
            badge.name(),
            inputs,
            s.agentUserId(),
            s.model(),
            s.maxTurns(),
            s.timeoutMs()),
        hash);
  }
}

package com.workplace.issue.outbound;

import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.IssueHistoryEntryResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 변화 시 Instant Context 요약을 재생성한다(write-time). IssueEventDispatcher 와 별도 리스너로 같은 이벤트를 구독한다.
 *
 * <p>RLS/tx/GUC 주의사항: issueAiSummaryExecutor 가 TenantContextTaskDecorator 로 호출 스레드의 테넌트를 워커로 전파하므로,
 * TransactionTemplate 이 여는 각 트랜잭션에서 TenantAwareTransactionManager 가 GUC(app.tenant_id)를 주입한다.
 *
 * <p>self-invoked @Transactional 을 사용하지 않는 이유: Spring @Transactional 은 프록시 경유로만 동작하기 때문에, 같은 빈 내부에서
 * 직접 호출하면 프록시를 우회해 트랜잭션이 열리지 않는다(GUC 미주입 → issue_ai_summary RLS fail-closed). 대신
 * TransactionTemplate 으로 명시적으로 트랜잭션을 감싼다.
 *
 * <p>HTTP 호출을 트랜잭션 밖에서 하는 이유: ai-agent 호출은 최대 90s 걸릴 수 있으며, 트랜잭션 안에 두면 DB 커넥션을 그 시간 내내 점유해 커넥션 고갈을
 * 유발한다(#232 패턴 교훈).
 */
@Slf4j
@Service
public class IssueAiSummaryService {

  /** 활동 게이트: 코멘트 수 + 히스토리 수 합산 최소치. 활동이 없는 방금 생성된 이슈는 요약 생성 생략. */
  static final int MIN_ACTIVITY = 2;

  private final IssueRepository issueRepo;
  private final IssueCommentRepository commentRepo;
  private final IssueHistoryRepository historyRepo;
  private final IssueAiSummaryRepository summaryRepo;
  private final AiAgentIssueClient client;
  private final TransactionTemplate txTemplate;

  /** 비서 에이전트 ID — AI 요약 요청 시 사용할 에이전트. */
  @Value("${workplace.ai-agent.assistant-agent-id:1}")
  long assistantAgentId;

  /** 요약 생성에 사용할 Claude 모델 ID. */
  @Value("${workplace.ai-agent.model:claude-sonnet-4-6}")
  String model;

  public IssueAiSummaryService(
      IssueRepository issueRepo,
      IssueCommentRepository commentRepo,
      IssueHistoryRepository historyRepo,
      IssueAiSummaryRepository summaryRepo,
      AiAgentIssueClient client,
      PlatformTransactionManager txManager) {
    this.issueRepo = issueRepo;
    this.commentRepo = commentRepo;
    this.historyRepo = historyRepo;
    this.summaryRepo = summaryRepo;
    this.client = client;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 이슈 생성 이벤트 핸들러. AFTER_COMMIT — 커밋 후 별도 워커 스레드에서 요약 재생성. */
  @Async("issueAiSummaryExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(IssueCreatedEvent e) {
    regenerate(e.issueId());
  }

  /** 코멘트 추가 이벤트 핸들러. AFTER_COMMIT — 커밋 후 별도 워커 스레드에서 요약 재생성. */
  @Async("issueAiSummaryExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCommented(IssueCommentedEvent e) {
    regenerate(e.issueId());
  }

  /** 상태 변경 이벤트 핸들러. AFTER_COMMIT — 커밋 후 별도 워커 스레드에서 요약 재생성. */
  @Async("issueAiSummaryExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onStatusChanged(IssueStatusChangedEvent e) {
    regenerate(e.issueId());
  }

  /**
   * 이슈 1건 요약 재생성.
   *
   * <ol>
   *   <li>tx1: 이슈 메타 + 코멘트 + 히스토리 수집(GUC 주입 필요 — RLS 보호 테이블)
   *   <li>활동 게이트: 코멘트+히스토리 합산 < MIN_ACTIVITY 이면 조기 반환
   *   <li>tx 밖: ai-agent HTTP 요청(최대 90s — 커넥션 비점유)
   *   <li>빈 가드: 빈 요약이면 저장 생략
   *   <li>tx2: issue_ai_summary upsert(GUC 주입 필요)
   * </ol>
   *
   * 패키지 가시성 — 테스트에서 직접 호출(TenantContext 명시 설정 후).
   */
  void regenerate(long issueId) {
    // ── 단계 1: 트랜잭션 안에서 메타·코멘트·히스토리 수집 ──────────────────────────────
    // TenantAwareTransactionManager 가 GUC 를 주입하므로 RLS-보호 issue_comment/issue_history 를 읽을 수 있다.
    Gathered gathered =
        txTemplate.execute(
            status -> {
              Optional<IssueRow> meta = issueRepo.findById(issueId);
              if (meta.isEmpty()) {
                return null; // 이슈가 삭제됐거나 없는 경우
              }
              List<IssueCommentResponse> comments = commentRepo.findByIssue(issueId);
              List<IssueHistoryEntryResponse> history = historyRepo.findByIssue(issueId);
              return new Gathered(meta.get(), comments, history);
            });

    if (gathered == null) {
      log.debug("이슈 메타 없음 — 요약 생략 issueId={}", issueId);
      return;
    }

    // ── 단계 2: 활동 게이트 ────────────────────────────────────────────────────────
    // 방금 생성된 이슈(코멘트+히스토리 없음)는 요약 카드 없음.
    int activityCount = gathered.comments().size() + gathered.history().size();
    if (activityCount < MIN_ACTIVITY) {
      log.debug("활동 게이트 미달({}/{}) — 요약 생략 issueId={}", activityCount, MIN_ACTIVITY, issueId);
      return;
    }

    // ── 단계 3: ai-agent HTTP 요청(트랜잭션 밖) ───────────────────────────────────
    // 최대 90s 소요 — 트랜잭션 밖에서 호출해 DB 커넥션을 점유하지 않는다.
    IssueSummaryRequest req = toRequest(gathered);
    IssueSummaryResult result;
    try {
      result = client.summarizeProgress(req);
    } catch (RuntimeException ex) {
      log.warn("이슈 요약 생성 실패 issueId={}: {}", issueId, ex.getMessage());
      return; // 실패 시 기존 저장본 유지 — 빈 요약으로 덮어쓰지 않음
    }

    // ── 단계 4: 빈 가드 ────────────────────────────────────────────────────────────
    // null 또는 공백 요약은 저장하지 않는다(쓰레기 캐싱 방지).
    if (result == null || result.summary() == null || result.summary().isBlank()) {
      log.debug("빈 요약 — 저장 생략 issueId={}", issueId);
      return;
    }

    // ── 단계 5: 트랜잭션 안에서 upsert ────────────────────────────────────────────
    // GUC 주입 필요 — issue_ai_summary 는 RLS FORCE 보호.
    String summary = result.summary();
    String nextAction = result.nextAction();
    txTemplate.executeWithoutResult(status -> summaryRepo.upsert(issueId, summary, nextAction));

    log.debug("이슈 요약 저장 완료 issueId={}", issueId);
  }

  /** 수집 데이터를 ai-agent 요청 DTO 로 변환. */
  private IssueSummaryRequest toRequest(Gathered g) {
    IssueRow meta = g.meta();
    List<IssueSummaryRequest.CommentLine> comments =
        g.comments().stream()
            .map(
                c ->
                    new IssueSummaryRequest.CommentLine(
                        c.authorName(), // 표시 이름(id 아님)
                        c.body(),
                        c.createdAt() != null ? c.createdAt().toString() : null))
            .toList();
    List<IssueSummaryRequest.HistoryLine> history =
        g.history().stream()
            .map(
                h ->
                    new IssueSummaryRequest.HistoryLine(
                        h.actorName(), // 표시 이름(id 아님)
                        h.eventType(),
                        h.fromValue(),
                        h.toValue(),
                        h.createdAt() != null ? h.createdAt().toString() : null))
            .toList();
    return new IssueSummaryRequest(
        meta.title(),
        meta.status(),
        meta.priority(),
        meta.dueDate() != null ? meta.dueDate().toString() : null,
        comments,
        history,
        assistantAgentId,
        model,
        8,
        60_000L);
  }

  /**
   * 수집 중간 결과 컨테이너 — 1개 트랜잭션에서 읽은 메타·코멘트·히스토리를 트랜잭션 밖에서 참조하기 위해 record 로 묶음.
   *
   * <p>패키지 가시성 — 단위 테스트에서 구조 검증 시 사용 가능.
   */
  record Gathered(
      IssueRow meta,
      List<IssueCommentResponse> comments,
      List<IssueHistoryEntryResponse> history) {}
}

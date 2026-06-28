package com.workplace.issue.outbound;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.IssueHistoryEntryResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.IssueAiAssistantUnavailableException;
import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.outbound.dto.ChatExcerpt;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 AI 현황 요약 서비스.
 *
 * <p><b>생성 경로:</b> 명시적 버튼({@link #generateOnDemand})이 유일한 생성 경로. 한 번 저장본이 생긴 이슈만 이벤트 리스너({@link
 * #regenerate})가 자동 갱신(opt-in).
 *
 * <p><b>agent 선택:</b> 프로젝트 유형 기반. PERSONAL → 프로젝트 소유자 개인 비서 우선(공용 폴백), TEAM → 테넌트 공용 비서. caller 신원
 * 기반이 아님(두 사용자가 같은 비서를 써야 하고, 자동 갱신 경로엔 caller 없음).
 *
 * <p><b>RLS/tx/GUC:</b>
 *
 * <ul>
 *   <li>{@code issueAiSummaryExecutor}(TenantContextTaskDecorator)가 워커 스레드로 테넌트를 전파 → 각 txTemplate
 *       이 GUC 주입.
 *   <li>HTTP(최대 90s)는 항상 트랜잭션 밖 — 커넥션 고갈 방지(#232).
 *   <li>self-invoked {@code @Transactional} 금지 — 프록시 우회 → GUC 미주입. 대신 TransactionTemplate 명시 사용.
 * </ul>
 */
@Slf4j
@Service
public class IssueAiSummaryService {

  /** 채팅 발췌 최대 행 수 — AI 컨텍스트 윈도우·비용 절감. */
  static final int CHAT_LIMIT = 50;

  private final IssueRepository issueRepo;
  private final IssueCommentRepository commentRepo;
  private final IssueHistoryRepository historyRepo;
  private final IssueAiSummaryRepository summaryRepo;
  private final AiAgentIssueClient client;
  private final TransactionTemplate txTemplate;
  private final AssistantResolver assistantResolver;
  private final ProjectRepository projectRepo;
  private final IssueChatExcerptReader chatReader;

  public IssueAiSummaryService(
      IssueRepository issueRepo,
      IssueCommentRepository commentRepo,
      IssueHistoryRepository historyRepo,
      IssueAiSummaryRepository summaryRepo,
      AiAgentIssueClient client,
      PlatformTransactionManager txManager,
      AssistantResolver assistantResolver,
      ProjectRepository projectRepo,
      IssueChatExcerptReader chatReader) {
    this.issueRepo = issueRepo;
    this.commentRepo = commentRepo;
    this.historyRepo = historyRepo;
    this.summaryRepo = summaryRepo;
    this.client = client;
    this.txTemplate = new TransactionTemplate(txManager);
    this.assistantResolver = assistantResolver;
    this.projectRepo = projectRepo;
    this.chatReader = chatReader;
  }

  /** 이슈 생성 이벤트 핸들러. AFTER_COMMIT — 커밋 후 별도 워커 스레드에서 opt-in 자동 갱신. */
  @Async("issueAiSummaryExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(IssueCreatedEvent e) {
    regenerate(e.issueId());
  }

  /** 코멘트 추가 이벤트 핸들러. AFTER_COMMIT — 커밋 후 별도 워커 스레드에서 opt-in 자동 갱신. */
  @Async("issueAiSummaryExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCommented(IssueCommentedEvent e) {
    regenerate(e.issueId());
  }

  /** 상태 변경 이벤트 핸들러. AFTER_COMMIT — 커밋 후 별도 워커 스레드에서 opt-in 자동 갱신. */
  @Async("issueAiSummaryExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onStatusChanged(IssueStatusChangedEvent e) {
    regenerate(e.issueId());
  }

  /** 사용자 요청(버튼) 경로 — 생성 실패/agent 없음/빈 요약은 예외로 전파(컨트롤러 4xx/5xx). */
  public void generateOnDemand(long issueId) {
    generateInternal(issueId);
  }

  /**
   * 요약 1건 생성·저장의 공통 코어.
   *
   * <ol>
   *   <li>tx1: 이슈 메타·본문·코멘트·히스토리·프로젝트 row 수집 + 채팅 발췌(포트) — GUC 주입 필요
   *   <li>프로젝트 유형별 agent 해석 — 없으면 IssueAiAssistantUnavailableException
   *   <li>tx 밖: ai-agent HTTP(최대 90s)
   *   <li>빈 가드: 공백 요약이면 IssueAiException
   *   <li>tx2: upsert
   * </ol>
   *
   * <p>주의: projectRepo.findById 도 tx1 안에서 실행 — PROJECT 테이블은 RLS 보호이므로 트랜잭션(GUC 주입) 밖에서 읽으면
   * fail-closed 로 빈 결과를 반환한다.
   */
  private void generateInternal(long issueId) {
    // ── 단계 1: 트랜잭션 안에서 메타·코멘트·히스토리·프로젝트 수집 ─────────────────────
    // TenantAwareTransactionManager 가 GUC 를 주입해 RLS-보호 테이블에 접근 가능.
    // projectRepo.findById 도 이 트랜잭션 안에서 실행 — RLS fail-closed 방지.
    Gathered gathered =
        txTemplate.execute(
            status -> {
              Optional<IssueRow> meta = issueRepo.findById(issueId);
              if (meta.isEmpty()) return null;
              IssueRow issue = meta.get();
              List<IssueCommentResponse> comments = commentRepo.findByIssue(issueId);
              List<IssueHistoryEntryResponse> history = historyRepo.findByIssue(issueId);
              List<ChatExcerpt> chat = chatReader.recentForIssue(issueId, CHAT_LIMIT);
              // 프로젝트 row 도 GUC 필요 — 같은 트랜잭션에서 읽는다
              Optional<ProjectRow> project = projectRepo.findById(issue.projectId());
              return new Gathered(issue, comments, history, chat, project.orElse(null));
            });

    if (gathered == null || gathered.project() == null) {
      log.debug("이슈 또는 프로젝트 메타 없음 — 요약 생략 issueId={}", issueId);
      return;
    }

    // ── 단계 2: 프로젝트 유형별 비서 해석 ───────────────────────────────────────────
    // PERSONAL → 소유자 개인 비서 우선(공용 폴백), TEAM → 테넌트 공용 비서.
    // AssistantResolver 메서드들은 @Transactional(readOnly)으로 자체 GUC 주입.
    AssistantSpec spec = resolveAssistant(gathered.project());

    // ── 단계 3: ai-agent HTTP 요청(트랜잭션 밖) ─────────────────────────────────────
    // 최대 90s — 커넥션 비점유.
    IssueSummaryRequest req = toRequest(gathered, spec);
    IssueSummaryResult result = client.summarizeProgress(req); // 실패 시 IssueAiException 전파

    // ── 단계 4: 빈 가드 ──────────────────────────────────────────────────────────────
    if (result == null || result.summary() == null || result.summary().isBlank()) {
      throw new IssueAiException("AI 가 빈 요약을 반환했어요. 잠시 후 다시 시도해주세요.", null);
    }

    // ── 단계 5: 트랜잭션 안에서 upsert ──────────────────────────────────────────────
    String summary = result.summary();
    String nextAction = result.nextAction();
    txTemplate.executeWithoutResult(s -> summaryRepo.upsert(issueId, summary, nextAction));
    log.debug("이슈 요약 저장 완료 issueId={}", issueId);
  }

  /**
   * 자동 갱신 — opt-in(저장본 존재) 이슈만. 저장본 없으면 자동 생성하지 않는다.
   *
   * <p>agent 미설정/빈 요약/HTTP 실패는 조용히 skip — 기존 저장본 유지.
   *
   * <p>패키지 가시성 — 테스트에서 직접 호출(TenantContext 명시 설정 후).
   */
  void regenerate(long issueId) {
    // opt-in 게이트: 저장본 없는 이슈는 자동 갱신 대상이 아님.
    if (!hasStoredSummary(issueId)) {
      log.debug("저장본 없음(미-opt-in) — 자동 요약 생략 issueId={}", issueId);
      return;
    }
    try {
      generateInternal(issueId);
    } catch (IssueAiAssistantUnavailableException | IssueAiException ex) {
      log.warn("이슈 요약 자동 갱신 실패 issueId={}: {}", issueId, ex.getMessage());
    }
  }

  /**
   * 저장본(opt-in) 존재 여부.
   *
   * <p>⚠️ 반드시 트랜잭션 안에서 조회한다 — issue_ai_summary 는 FORCE RLS 라, @Async 워커 스레드에서 tx 밖 bare read 하면
   * GUC(app.tenant_id) 미주입 → fail-closed 로 항상 empty 가 되어 자동 갱신이 영구 skip 된다. (테스트 프로파일은 세션 GUC 기본값이
   * 있어 마스킹되므로 프로덕션에서만 드러나는 함정.)
   *
   * <p>패키지 가시성 — RLS 가드 테스트에서 비-default 테넌트로 직접 호출.
   */
  boolean hasStoredSummary(long issueId) {
    return Boolean.TRUE.equals(txTemplate.execute(s -> summaryRepo.find(issueId).isPresent()));
  }

  /**
   * 프로젝트 유형별 비서 해석.
   *
   * <ul>
   *   <li>PERSONAL: 소유자 개인 비서 우선 → 공용 비서 폴백
   *   <li>TEAM: 테넌트 공용 비서
   * </ul>
   *
   * 토큰 보유 agent 없으면 {@link IssueAiAssistantUnavailableException}.
   */
  private AssistantSpec resolveAssistant(ProjectRow project) {
    Optional<AssistantSpec> spec =
        "PERSONAL".equals(project.type())
            ? assistantResolver.resolveOrEmpty(project.ownerId())
            : assistantResolver.resolveWorkspaceOrEmpty();
    return spec.orElseThrow(IssueAiAssistantUnavailableException::new);
  }

  /** 수집 데이터를 ai-agent 요청 DTO 로 변환. spec·body·chat 포함. */
  private IssueSummaryRequest toRequest(Gathered g, AssistantSpec spec) {
    IssueRow meta = g.meta();
    List<IssueSummaryRequest.CommentLine> comments =
        g.comments().stream()
            .map(
                c ->
                    new IssueSummaryRequest.CommentLine(
                        c.authorName(),
                        c.body(),
                        c.createdAt() != null ? c.createdAt().toString() : null))
            .toList();
    List<IssueSummaryRequest.HistoryLine> history =
        g.history().stream()
            .map(
                h ->
                    new IssueSummaryRequest.HistoryLine(
                        h.actorName(),
                        h.eventType(),
                        h.fromValue(),
                        h.toValue(),
                        h.createdAt() != null ? h.createdAt().toString() : null))
            .toList();
    List<IssueSummaryRequest.ChatLine> chat =
        g.chat().stream()
            .map(
                m ->
                    new IssueSummaryRequest.ChatLine(
                        m.authorName(),
                        m.authorKind(),
                        m.body(),
                        m.createdAt() != null ? m.createdAt().toString() : null))
            .toList();
    return new IssueSummaryRequest(
        meta.title(),
        // 본문 없는 이슈는 null 대신 빈 문자열 — ai-agent zod(string)가 null 을 거부(400)하지 않도록.
        meta.body() != null ? meta.body() : "",
        meta.status(),
        meta.priority(),
        meta.dueDate() != null ? meta.dueDate().toString() : null,
        comments,
        history,
        chat,
        spec.agentUserId(),
        spec.model(),
        spec.maxTurns(),
        spec.timeoutMs());
  }

  /**
   * 수집 중간 결과 컨테이너. 1개 트랜잭션에서 읽은 메타·코멘트·히스토리·채팅·프로젝트를 트랜잭션 밖에서 참조하기 위해 record 로 묶음.
   *
   * <p>패키지 가시성 — 단위 테스트에서 구조 검증 시 사용 가능.
   */
  record Gathered(
      IssueRow meta,
      List<IssueCommentResponse> comments,
      List<IssueHistoryEntryResponse> history,
      List<ChatExcerpt> chat,
      ProjectRow project) {}
}

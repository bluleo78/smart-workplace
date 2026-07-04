package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.mail.dto.LinkedIssue;
import com.workplace.mail.dto.MailIssueDraft;
import com.workplace.mail.dto.PromoteToIssueRequest;
import com.workplace.mail.dto.PromotedIssue;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.mail.util.MailBodyText;
import com.workplace.project.service.ProjectService;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * #520 메일→이슈 승격(cross-app). 사용자가 모달에서 확정한 필드로 일반 IssueService.create 를 호출(사용자 권한·멤버십 가드 재사용)하고, 생성
 * 이슈에 메일 출처(source_type='MAIL', source_id=messageId)를 스탬프한다. AI 담당 선택 시 IssueService.create 가
 * IssueAssignedEvent 를 발행하므로 기존 이슈-AI 흐름이 자동 연결된다(추가 구현 없음).
 *
 * <p>draftIssue 는 MailAiService.summarize 의 short-tx 패턴을 따른다: RLS GUC 는 tx-local 이라 메일 컨텍스트·후보 프로젝트
 * 조회만 txTemplate 으로 감싸고, LLM 호출(최대 90s)은 tx 밖에서 수행해 DB 커넥션을 점유하지 않는다(#232).
 */
@Service
public class MailIssueService {

  /** 단발 호출이라 turn 1 고정. */
  private static final int MAX_TURNS = 1;

  private final IssueService issueService;
  private final IssueRepository issueRepository;
  private final EmailMessageRepository messageRepo;
  private final AiAgentMailClient mailClient;
  private final AssistantResolver assistantResolver;
  private final ProjectService projectService;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  public MailIssueService(
      IssueService issueService,
      IssueRepository issueRepository,
      EmailMessageRepository messageRepo,
      AiAgentMailClient mailClient,
      AssistantResolver assistantResolver,
      ProjectService projectService,
      PlatformTransactionManager txManager) {
    this.issueService = issueService;
    this.issueRepository = issueRepository;
    this.messageRepo = messageRepo;
    this.mailClient = mailClient;
    this.assistantResolver = assistantResolver;
    this.projectService = projectService;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * #520 메일→이슈 승격. 소유권 검증 후 사용자 권한으로 이슈를 생성하고, 메일 출처를 스탬프한다.
   *
   * <p>@Transactional 필수 — IssueService.create + messageRepo 소유 검증 + updateSource 가 한 트랜잭션의 GUC 주입
   * 아래에서 RLS-safe 하게 동작.
   */
  @Transactional
  public PromotedIssue promoteToIssue(long callerId, long messageId, PromoteToIssueRequest req) {
    // 소유권 검증 — 타 사용자 메시지면 404
    messageRepo
        .findAiContextByIdAndUser(callerId, messageId)
        .orElseThrow(() -> new EmailMessageNotFoundException(messageId));

    List<Long> assigneeIds = req.assigneeIds() == null ? List.of() : req.assigneeIds();
    IssueResponse created =
        issueService.create(
            callerId,
            req.projectKey(),
            new CreateIssueRequest(
                req.title(), req.body(), req.priority(), null, assigneeIds, null, null, null));
    issueRepository.updateSource(created.id(), "MAIL", messageId);
    String issueKey = created.projectKey() + "-" + created.number();
    return new PromotedIssue(issueKey);
  }

  /**
   * #520 메일을 이슈 초안으로 변환(미영속). RLS GUC 는 tx-local 이라 메일 컨텍스트·후보 프로젝트 조회만 짧은 tx 로 감싸고, LLM 호출(최대
   * 90s)은 tx 밖에서 수행해 DB 커넥션을 점유하지 않는다.
   *
   * <p>AI 추천 projectKey 가 후보에 없으면 null 로 설정(프론트가 개인 프로젝트로 폴백).
   */
  public MailIssueDraft draftIssue(long callerId, long messageId) {
    // 메일 컨텍스트 조회(소유 검증 + ai_enabled 포함) — short-tx
    AiContext ctx =
        txTemplate.execute(
            status ->
                messageRepo
                    .findAiContextByIdAndUser(callerId, messageId)
                    .orElseThrow(() -> new EmailMessageNotFoundException(messageId)));
    requireEnabled(ctx);
    AssistantSpec spec = requireSpec(callerId);

    // 후보 프로젝트(사용자 멤버) — short-tx 로 RLS-safe 조회. 페이지 충분히 크게.
    List<MailIssueDraft.CandidateProject> candidates =
        txTemplate.execute(
            status ->
                projectService.list(callerId, 0, 100).content().stream()
                    .map(p -> new MailIssueDraft.CandidateProject(p.key(), p.name()))
                    .toList());

    String body = MailBodyText.effectiveBody(ctx.bodyText(), ctx.bodyHtml());
    List<MailAiMessages.CandidateProject> aiCandidates =
        candidates.stream()
            .map(c -> new MailAiMessages.CandidateProject(c.key(), c.name()))
            .toList();
    MailAiMessages.IssueDraftResult r =
        mailClient.issueDraft(
            new MailAiMessages.IssueDraftRequest(
                nz(ctx.subject()),
                nz(body),
                aiCandidates,
                spec.agentUserId(),
                spec.model(),
                MAX_TURNS,
                spec.timeoutMs()));

    // AI 추천 projectKey 가 후보에 없으면 무시(null) — 프론트가 개인 프로젝트로 폴백.
    String suggested =
        candidates.stream().anyMatch(c -> c.key().equals(r.projectKey())) ? r.projectKey() : null;
    return new MailIssueDraft(r.title(), r.body(), r.priority(), suggested, candidates);
  }

  /** #520 메일에 연결된 이슈 키 조회(배지). 연결 없으면 issueKey=null. */
  @Transactional(readOnly = true)
  public LinkedIssue findLinkedIssue(long callerId, long messageId) {
    // 소유하지 않은 메일이면 RLS/소유 가드로 404 — 기존 컨텍스트 조회 재사용.
    messageRepo
        .findAiContextByIdAndUser(callerId, messageId)
        .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
    return new LinkedIssue(issueRepository.findSourceIssueKey("MAIL", messageId).orElse(null));
  }

  private void requireEnabled(AiContext ctx) {
    if (!ctx.aiEnabled()) {
      throw new MailAiUnavailableException("이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.");
    }
  }

  private AssistantSpec requireSpec(long userId) {
    try {
      return assistantResolver.resolve(userId);
    } catch (Exception e) {
      throw new MailAiUnavailableException("AI 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요.");
    }
  }

  private String nz(String s) {
    return s == null ? "" : s;
  }
}

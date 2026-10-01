package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.dto.CoachingNote;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailDraftCoaching;
import com.workplace.mail.dto.MailDraftCoachingRequest;
import com.workplace.mail.dto.MailReplyDraft;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingRequest;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingResult;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftRequest;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftResult;
import com.workplace.mail.outbound.MailAiMessages.ThreadMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.mail.repository.EmailMessageRepository.AnalysisContext;
import com.workplace.mail.service.MailSummaryDecider.Decision;
import com.workplace.mail.service.MailSummaryDecider.Outcome;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * 메일 AI 사용자 기능(7d · WP-149): 요약 표시·강제 생성("AI 요약" 버튼)·답장 초안·초안 코칭. 분류·요약 생성 자체는 {@link
 * MailAnalysisService} (③ 원본 분석 · ④ 개인 분석)가 맡는다. 비서 사양은 home 과 동일하게 AssistantResolver 로 해석(미설정 시
 * 503).
 */
@Slf4j
@Service
public class MailAiService {

  /** 단발 호출이라 turn 1 고정. */
  private static final int MAX_TURNS = 1;

  private final MailAnalysisService analysis;
  private final AiAgentMailClient mailClient;
  private final EmailMessageRepository messageRepo;
  private final EmailAccountRepository accountRepo;
  private final AssistantResolver assistantResolver;

  public MailAiService(
      MailAnalysisService analysis,
      AiAgentMailClient mailClient,
      EmailMessageRepository messageRepo,
      EmailAccountRepository accountRepo,
      AssistantResolver assistantResolver) {
    this.analysis = analysis;
    this.mailClient = mailClient;
    this.messageRepo = messageRepo;
    this.accountRepo = accountRepo;
    this.assistantResolver = assistantResolver;
  }

  /**
   * 메일 상세의 요약(WP-149). 표시 = 개인 ?? 공통. 요약이 없으면 상태(SKIPPED: "AI 요약" 버튼, EMPTY: 숨김)를 돌려주고, 선택 티어가 아직
   * 분석 전이면 지금 분석해 결과를 돌려준다(선제 분석 지연 보완). 티어: AI 사용 + 개인 비서 → 개인, 아니면 공통.
   *
   * <p>LLM 호출은 트랜잭션 밖(#232) — 컨텍스트 조회·저장은 분석 서비스의 짧은 트랜잭션이 맡는다. 시도조차 못 하면(비서 미설정·본문 미적재) 기존 계약대로
   * 503 — 웹 쿼리는 재시도하고, EMPTY 를 캐시해 영구히 숨기지 않는다.
   */
  public MailSummary summarize(long userId, long messageId) {
    AnalysisContext ctx = contextOrThrow(userId, messageId);
    boolean personalTier = personalTier(userId, ctx);
    Outcome first = MailSummaryDecider.decide(MailSummaryDecider.stateOf(ctx, personalTier));
    if (first.decision() != Decision.GENERATE) {
      return toResponse(first);
    }
    if (personalTier) {
      analysis.generatePersonalSummary(userId, messageId, false);
    } else {
      analysis.generateContentSummary(userId, messageId, false);
    }
    Outcome after =
        MailSummaryDecider.decide(
            MailSummaryDecider.stateOf(contextOrThrow(userId, messageId), personalTier));
    if (after.decision() == Decision.GENERATE) {
      throw unavailable(personalTier);
    }
    return toResponse(after);
  }

  /**
   * "AI 요약" 버튼(WP-149) — 생략을 무시하고 선택 티어로 요약을 강제 생성한다. 이미 요약이 있으면 그대로(캐시). 비서가 없으면 503, LLM 실패는
   * 502(MailAiException).
   */
  public MailSummary forceSummarize(long userId, long messageId) {
    AnalysisContext ctx = contextOrThrow(userId, messageId);
    String display = firstNonBlank(ctx.personalSummary(), ctx.contentSummary());
    if (display != null) {
      return MailSummary.ready(display);
    }
    boolean ran =
        personalTier(userId, ctx)
            ? analysis.generatePersonalSummary(userId, messageId, true)
            : analysis.generateContentSummary(userId, messageId, true);
    if (!ran) {
      throw unavailable(personalTier(userId, ctx));
    }
    AnalysisContext after = contextOrThrow(userId, messageId);
    String result = firstNonBlank(after.personalSummary(), after.contentSummary());
    return result != null ? MailSummary.ready(result) : MailSummary.empty();
  }

  /**
   * 요약 503 — 비서가 실제로 없을 때만 "미설정" 문구, 그 외(본문 미적재·동시 분석 대기 실패 등)는 일반 문구로 구분한다. 개인 티어면 개인 비서가 있다는 뜻이므로
   * 공통 비서 유무만 본다.
   */
  private MailAiUnavailableException unavailable(boolean personalTier) {
    if (!personalTier && assistantResolver.resolveWorkspaceOrEmpty().isEmpty()) {
      return new MailAiUnavailableException("AI 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요.");
    }
    return new MailAiUnavailableException("요약을 아직 만들 수 없어요. 잠시 후 다시 시도해 주세요.");
  }

  /** 개인 티어 여부 — AI 사용 계정 + 개인 비서(현행 규칙). */
  private boolean personalTier(long userId, AnalysisContext ctx) {
    return ctx.aiEnabled() && assistantResolver.resolvePersonalOrEmpty(userId).isPresent();
  }

  private AnalysisContext contextOrThrow(long userId, long messageId) {
    AnalysisContext ctx = analysis.readContext(userId, messageId);
    if (ctx == null) {
      throw new EmailMessageNotFoundException(messageId);
    }
    return ctx;
  }

  /** 판정 → 응답(GENERATE 는 호출 전에 처리됨). */
  private static MailSummary toResponse(Outcome o) {
    return switch (o.decision()) {
      case READY -> MailSummary.ready(o.text());
      case SKIPPED -> MailSummary.skipped();
      default -> MailSummary.empty();
    };
  }

  private String firstNonBlank(String a, String b) {
    if (StringUtils.hasText(a)) {
      return a;
    }
    return StringUtils.hasText(b) ? b : null;
  }

  /**
   * AI 답장 초안(미영속). 스레드 전체를 맥락으로. ai_enabled=false 면 503.
   *
   * <p>RLS GUC 주입 위해 @Transactional(readOnly) 필수 — 없으면 첫 RLS 스코프 SELECT 가 빈 결과 → 거짓 404. DB 쓰기
   * 없음(초안 미영속)이라 readOnly. <b>트레이드오프</b>: LLM 호출(최대 90s) 동안 DB 커넥션을 점유한다 — 짧은-트랜잭션 리팩터링은 후속 과제(#230
   * 보고서 참조).
   */
  @Transactional(readOnly = true)
  public MailReplyDraft replyDraft(long userId, long messageId) {
    AiContext ctx =
        messageRepo
            .findAiContextByIdAndUser(userId, messageId)
            .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
    requireEnabled(ctx);
    AssistantSpec spec = requireSpec(userId);
    List<ThreadMessage> thread = messageRepo.findThreadByIdAndUser(userId, messageId);
    ReplyDraftResult r =
        mailClient.replyDraft(
            new ReplyDraftRequest(
                thread,
                nz(ctx.selfAddress()),
                spec.agentUserId(),
                spec.model(),
                MAX_TURNS,
                spec.timeoutMs()));
    return new MailReplyDraft(r.draftBody());
  }

  /**
   * 초안 코칭(미영속): 내 초안을 톤·명료성(답장이면 완결성까지) 관점으로 코칭하고 개선본을 제시한다. ai_enabled=false 면 503, 타 계정이면 404.
   * 소유권·ai_enabled 게이트를 LLM 호출보다 먼저 통과시킨다.
   *
   * <p>RLS GUC 주입을 위해 @Transactional(readOnly) — DB 쓰기 없음. LLM 호출(최대 timeoutMs) 동안 커넥션 점유는
   * reply-draft 와 동일한 후속 과제(#230).
   */
  @Transactional(readOnly = true)
  public MailDraftCoaching coachDraft(long userId, MailDraftCoachingRequest req) {
    // 소유권 검증 먼저 — 타 계정/없음이면 404.
    EmailAccountResponse acct =
        accountRepo
            .findByIdAndUser(userId, req.accountId())
            .orElseThrow(() -> new EmailAccountNotFoundException(req.accountId()));
    // ai_enabled 게이트.
    if (!acct.aiEnabled()) {
      throw new MailAiUnavailableException("이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.");
    }
    AssistantSpec spec = requireSpec(userId);
    // 답장이면 원문 스레드 동봉(소유 검증 포함), 새 메일이면 빈 리스트.
    List<ThreadMessage> thread =
        req.inReplyToMessageId() == null
            ? List.of()
            : messageRepo.findThreadByIdAndUser(userId, req.inReplyToMessageId());
    DraftCoachingResult r =
        mailClient.coachDraft(
            new DraftCoachingRequest(
                nz(req.bodyText()),
                thread,
                nz(acct.emailAddress()),
                spec.agentUserId(),
                spec.model(),
                MAX_TURNS,
                spec.timeoutMs()));
    List<CoachingNote> notes =
        r.notes() == null
            ? List.of()
            : r.notes().stream().map(n -> new CoachingNote(n.dimension(), n.message())).toList();
    return new MailDraftCoaching(notes, nz(r.improvedBodyHtml()));
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

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
import com.workplace.mail.outbound.MailAiMessages.ClassifyRequest;
import com.workplace.mail.outbound.MailAiMessages.ClassifyResult;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingRequest;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingResult;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftRequest;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftResult;
import com.workplace.mail.outbound.MailAiMessages.SummarizeRequest;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import com.workplace.mail.outbound.MailAiMessages.ThreadMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.mail.util.MailBodyText;
import java.util.List;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

/**
 * 메일 AI 오케스트레이션(7d): 분류(동기화 잡 best-effort)·요약(캐시)·답장 초안. 모든 경로는 계정 ai_enabled 게이트. 비서 사양은 home 과
 * 동일하게 AssistantResolver 로 해석(개인→공용, 미설정 시 분류 생략/요약·답장 503).
 */
@Slf4j
@Service
public class MailAiService {

  /** 분류 허용 카테고리(미지 값은 폐기). ⚠️ 프론트 MailSidebar.CATEGORIES 와 값·순서 일치 유지 */
  private static final Set<String> CATEGORIES = Set.of("업무", "개인", "알림", "프로모션", "뉴스레터");

  /** 단발 호출이라 turn 1 고정. */
  private static final int MAX_TURNS = 1;

  private final AiAgentMailClient mailClient;
  private final EmailMessageRepository messageRepo;
  private final EmailAccountRepository accountRepo;
  private final AssistantResolver assistantResolver;

  /**
   * 짧은-트랜잭션용 TransactionTemplate — @Primary {@code TenantAwareTransactionManager} 로 구성해 트랜잭션 진입 시
   * RLS GUC(app.tenant_id) 가 주입된다.
   */
  private final TransactionTemplate txTemplate;

  public MailAiService(
      AiAgentMailClient mailClient,
      EmailMessageRepository messageRepo,
      EmailAccountRepository accountRepo,
      AssistantResolver assistantResolver,
      PlatformTransactionManager txManager) {
    this.mailClient = mailClient;
    this.messageRepo = messageRepo;
    this.accountRepo = accountRepo;
    this.assistantResolver = assistantResolver;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 동기화 잡용 비서 사양. 미설정이면 null → 분류 생략(예외 전파 안 함). */
  public AssistantSpec resolveSpecOrNull(long userId) {
    try {
      return assistantResolver.resolve(userId);
    } catch (Exception e) {
      log.warn("메일 AI 비서 미설정 — 분류 생략 (userId={}): {}", userId, e.toString());
      return null;
    }
  }

  /**
   * messageId 기준 분류(본문 적재 후 호출). subject/from/snippet 을 DB 에서 읽어 분류한다. best-effort: 어떤 실패도 삼키고 적재
   * 흐름을 막지 않는다.
   */
  public void classifyAndStore(long userId, long messageId, AssistantSpec spec) {
    try {
      var ctx = messageRepo.findClassifyContextByIdAndUser(userId, messageId).orElse(null);
      if (ctx == null) {
        return;
      }
      ClassifyResult r =
          mailClient.classify(
              new ClassifyRequest(
                  nz(ctx.subject()),
                  nz(ctx.fromAddress()),
                  nz(ctx.snippet()),
                  spec.agentUserId(),
                  spec.model(),
                  MAX_TURNS,
                  spec.timeoutMs()));
      String category = CATEGORIES.contains(r.category()) ? r.category() : null;
      messageRepo.updateClassification(messageId, category, r.needsReply());
    } catch (Exception e) {
      log.warn("메일 분류 건너뜀 (messageId={}): {}", messageId, e.toString());
    }
  }

  /**
   * T1 객관적 요약(공통비서 전용, best-effort). 공통비서가 없거나·이미 요약됐거나·본문이 비면 skip. 계정 ai_enabled 와 무관 — 공통비서가 있으면
   * 모든 메일을 객관적으로 요약한다.
   */
  public void ensureObjectiveSummary(long userId, long messageId) {
    AiContext ctx = readContext(userId, messageId);
    if (ctx == null || ctx.summaryAttempted()) {
      return; // 미존재 또는 이미 공통요약 시도됨(#484: 빈 결과였어도 재요약하지 않음)
    }
    AssistantSpec spec = assistantResolver.resolveWorkspaceOrEmpty().orElse(null);
    if (spec == null) {
      return; // 공통비서 미설정 — T1 skip
    }
    String body = summarizableBody(ctx);
    if (body == null) {
      return; // 빈본문 — LLM 미호출이라 시도 기록도 남기지 않음
    }
    String summary = callSummarize(ctx, body, spec);
    // #484: LLM 빈 결과면 저장소가 summary=NULL 로 시도 시각만 기록('시도했으나 결과 없음')
    txTemplate.executeWithoutResult(status -> messageRepo.updateSummary(messageId, summary));
  }

  /**
   * T2 개인 맞춤 요약(개인비서 전용, best-effort). aiEnabled=false 거나·개인비서 없거나·이미 개인요약됐거나· 본문이 비면 skip. 공통비서로
   * 폴백하지 않는다(객관적 요약 중복 방지).
   */
  public void ensurePersonalSummary(long userId, long messageId) {
    AiContext ctx = readContext(userId, messageId);
    if (ctx == null || !ctx.aiEnabled()) {
      return; // 미존재 또는 개인 AI opt-in 아님
    }
    if (ctx.personalSummaryAttempted()) {
      return; // 이미 개인요약 시도됨(#484: 빈 결과였어도 재요약하지 않음)
    }
    AssistantSpec spec = assistantResolver.resolvePersonalOrEmpty(userId).orElse(null);
    if (spec == null) {
      return; // 진짜 개인비서 없음 — T2 skip
    }
    String body = summarizableBody(ctx);
    if (body == null) {
      return; // 빈본문 — 시도 기록 없음
    }
    String summary = callSummarize(ctx, body, spec);
    // #484: LLM 빈 결과면 저장소가 summary=NULL 로 시도 시각만 기록
    txTemplate.executeWithoutResult(
        status -> messageRepo.updatePersonalSummary(messageId, summary));
  }

  /**
   * 온디맨드 표시용 요약. 개인 ?? 공통. 캐시 없으면 가능한 쪽을 생성: aiEnabled+개인비서면 개인요약, 아니면 공통비서면 객관적요약. 둘 다 불가하면 503.
   *
   * <p>RLS GUC(app.tenant_id)는 트랜잭션-로컬이라 컨텍스트 조회·캐시 쓰기만 짧은 트랜잭션({@code txTemplate})으로 감싼다. LLM 호출은
   * 트랜잭션 밖(#232). 비서 사양 해석은 자체 @Transactional(readOnly) 로 GUC 를 주입한다.
   *
   * <p>#484: 선택된 티어가 이미 '시도했으나 결과 없음'이면 재요약하지 않고 {@code summary=null}(요약 없음)로 응답한다 — 매 상세 조회마다 LLM
   * 을 다시 부르는 비용 누수 방지. 프론트는 null 요약이면 카드를 숨긴다.
   */
  public MailSummary summarize(long userId, long messageId) {
    AiContext ctx = readContextOrThrow(userId, messageId);
    String display = firstNonBlank(ctx.personalSummary(), ctx.summary());
    if (display != null) {
      return new MailSummary(display);
    }
    // 캐시 미스 — 티어 선택: aiEnabled+개인비서면 개인요약, 아니면 공통요약.
    boolean personalTier =
        ctx.aiEnabled() && assistantResolver.resolvePersonalOrEmpty(userId).isPresent();
    // ensure* 도 같은 검사를 하지만, 여기서 먼저 끊으면 재조회 왕복 없이 바로 응답한다.
    if (attemptedFor(ctx, personalTier)) {
      return new MailSummary(null); // 이미 시도했으나 결과 없음 — 재요약 금지
    }
    if (personalTier) {
      ensurePersonalSummary(userId, messageId);
    } else {
      ensureObjectiveSummary(userId, messageId);
    }
    AiContext after = readContextOrThrow(userId, messageId);
    String result = firstNonBlank(after.personalSummary(), after.summary());
    if (result != null) {
      return new MailSummary(result);
    }
    if (attemptedFor(after, personalTier)) {
      return new MailSummary(null); // 방금 시도했으나 LLM 이 빈 결과 — 요약 없음
    }
    // 시도조차 못함(비서 미설정 등) — 기존 계약대로 503
    throw new MailAiUnavailableException("AI 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요.");
  }

  /** 선택된 티어(개인/공통)의 요약 시도 여부(summarized_at 존재). */
  private static boolean attemptedFor(AiContext ctx, boolean personalTier) {
    return personalTier ? ctx.personalSummaryAttempted() : ctx.summaryAttempted();
  }

  /**
   * 요약할 본문(없으면 null). 빈본문은 LLM 을 부르지 않고 시도로도 기록하지 않는다 — 온디맨드 경로는 IMAP 본문 적재 전에 올 수 있어 '진짜 빈 메일'과
   * '아직 미적재'를 구분할 수 없다. 기록하면 본문이 나중에 적재돼도 영구히 요약 대상에서 빠진다.
   */
  private static String summarizableBody(AiContext ctx) {
    String body = MailBodyText.effectiveBody(ctx.bodyText(), ctx.bodyHtml());
    return StringUtils.hasText(body) ? body : null;
  }

  /** 공통비서/개인비서 spec 으로 본문 요약 LLM 호출. 빈/공백 응답의 NULL 정규화는 저장소(updateSummary)가 담당(#484). */
  private String callSummarize(AiContext ctx, String body, AssistantSpec spec) {
    SummarizeResult r =
        mailClient.summarize(
            new SummarizeRequest(
                nz(ctx.subject()),
                nz(ctx.fromAddress()),
                body,
                spec.agentUserId(),
                spec.model(),
                MAX_TURNS,
                spec.timeoutMs()));
    return r.summary();
  }

  /** RLS GUC 주입 짧은 트랜잭션으로 컨텍스트 조회(없으면 null). */
  private AiContext readContext(long userId, long messageId) {
    return txTemplate.execute(
        status -> messageRepo.findAiContextByIdAndUser(userId, messageId).orElse(null));
  }

  private AiContext readContextOrThrow(long userId, long messageId) {
    AiContext ctx = readContext(userId, messageId);
    if (ctx == null) {
      throw new EmailMessageNotFoundException(messageId);
    }
    return ctx;
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

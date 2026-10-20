package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.util.Texts;
import com.workplace.mail.dto.CoachingNote;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailComposeDraft;
import com.workplace.mail.dto.MailComposeDraftRequest;
import com.workplace.mail.dto.MailDraftCoaching;
import com.workplace.mail.dto.MailDraftCoachingRequest;
import com.workplace.mail.dto.MailReplyDraft;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.ComposeDraftRequest;
import com.workplace.mail.outbound.MailAiMessages.ComposeDraftResult;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingRequest;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingResult;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftRequest;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftResult;
import com.workplace.mail.outbound.MailAiMessages.ThreadMessage;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.mail.repository.EmailMessageRepository.AnalysisContext;
import com.workplace.mail.repository.MailPeopleRepository;
import com.workplace.mail.service.MailSummaryDecider.Decision;
import com.workplace.mail.service.MailSummaryDecider.Outcome;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 AI 사용자 기능(7d · WP-149): 요약 표시·강제 생성("AI 요약" 버튼)·답장 초안·초안 코칭·새 메일 초안(WP-576 compose-draft).
 * 분류·요약 생성 자체는 {@link MailAnalysisService} (③ 원본 분석 · ④ 개인 분석)가 맡는다. 비서 사양은 home 과 동일하게
 * AssistantResolver 로 해석(미설정 시 503).
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

  /** WP-381: 답장 초안·초안 코칭에 싣는 읽기 전용 메모리(공통 + 메일). */
  private final AiMemoryReader memoryReader;

  /** WP-386: 답장 초안·초안 코칭에 싣는 조직 공용 메모리 리더(메일은 공간이 없다). */
  private final SharedAiMemoryReader sharedReader;

  /** WP-576: 새 메일 초안의 보내는 사람 이름("나" 프로필) 조회용. */
  /** 보내는 사람 이름 조회(WP-576 새 메일 초안의 맺음 인사) — 게이트와 같은 읽기 트랜잭션에서 이름만 읽는다. */
  private final MailPeopleRepository peopleRepo;

  /**
   * 답장 초안·초안 코칭의 짧은 읽기 트랜잭션 — @Primary TenantAwareTransactionManager 로 구성해 진입 시 RLS
   * GUC(app.tenant_id) 가 주입된다. 소유권·ai_enabled·스레드 조회만 감싸고 메모리 읽기·LLM 호출은 밖에서 한다.
   */
  private final TransactionTemplate readTx;

  public MailAiService(
      MailAnalysisService analysis,
      AiAgentMailClient mailClient,
      EmailMessageRepository messageRepo,
      EmailAccountRepository accountRepo,
      AssistantResolver assistantResolver,
      AiMemoryReader memoryReader,
      PlatformTransactionManager txManager,
      SharedAiMemoryReader sharedReader,
      MailPeopleRepository peopleRepo) {
    this.analysis = analysis;
    this.mailClient = mailClient;
    this.messageRepo = messageRepo;
    this.accountRepo = accountRepo;
    this.assistantResolver = assistantResolver;
    this.memoryReader = memoryReader;
    this.sharedReader = sharedReader;
    this.peopleRepo = peopleRepo;
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
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
    Outcome first = MailSummaryDecider.decide(ctx, personalTier);
    if (first.decision() != Decision.GENERATE) {
      return toResponse(first);
    }
    if (personalTier) {
      analysis.generatePersonalSummary(userId, messageId, false);
    } else {
      analysis.generateContentSummary(userId, messageId, false);
    }
    Outcome after = MailSummaryDecider.decide(contextOrThrow(userId, messageId), personalTier);
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
    String display = MailSummaryDecider.display(ctx);
    if (display != null) {
      return MailSummary.ready(display);
    }
    boolean personalTier = personalTier(userId, ctx);
    boolean ran =
        personalTier
            ? analysis.generatePersonalSummary(userId, messageId, true)
            : analysis.generateContentSummary(userId, messageId, true);
    if (!ran) {
      throw unavailable(personalTier);
    }
    AnalysisContext after = contextOrThrow(userId, messageId);
    String result = MailSummaryDecider.display(after);
    return result != null ? MailSummary.ready(result) : MailSummary.empty();
  }

  /**
   * 요약 503 — 비서가 실제로 없을 때만 "미설정" 문구, 그 외(본문 미적재·동시 분석 대기 실패 등)는 일반 문구로 구분한다. 개인 티어면 개인 비서가 있다는 뜻이므로
   * 공통 비서 유무만 본다.
   */
  private MailAiUnavailableException unavailable(boolean personalTier) {
    if (!personalTier && assistantResolver.resolveWorkspaceOrEmpty().isEmpty()) {
      return MailAiUnavailableException.assistantNotConfigured();
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

  /**
   * AI 답장 초안(미영속). 스레드 전체를 맥락으로. ai_enabled=false 면 503.
   *
   * <p>소유권·ai_enabled·비서·스레드 조회는 짧은 읽기 트랜잭션({@link #readTx}) 안에서 한다 — RLS GUC 가 없으면 첫 RLS 스코프
   * SELECT 가 빈 결과 → 거짓 404. 메모리 읽기(WP-381, 공통 + 메일 — 트랜잭션 밖에서 부르는 이유는 {@link
   * AiMemoryReader#readForEntry})와 LLM 호출(최대 90s)은 트랜잭션이 끝난 뒤 한다 — LLM 호출 동안 커넥션을 쥐지 않는다(#230).
   */
  public MailReplyDraft replyDraft(long userId, long messageId) {
    TxInput in =
        readTx.execute(
            s -> {
              AiContext ctx =
                  messageRepo
                      .findAiContextByIdAndUser(userId, messageId)
                      .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
              requireEnabled(ctx.aiEnabled());
              AssistantSpec spec = requireSpec(userId);
              return new TxInput(
                  ctx.selfAddress(),
                  spec,
                  messageRepo.findThreadByIdAndUser(userId, messageId),
                  memoryQuery(ctx));
            });
    // WP-386: 메일은 공간이 없어 조직 공용 메모리만(메모리 꺼짐과 무관).
    SharedMemories shared = SharedMemories.orEmpty(sharedReader.readForUser(userId, null, null));
    ReplyDraftResult r =
        mailClient.replyDraft(
            new ReplyDraftRequest(
                in.thread(),
                nz(in.selfAddress()),
                in.spec().agentUserId(),
                in.spec().model(),
                MAX_TURNS,
                in.spec().timeoutMs(),
                memoryReader.readForEntry(userId, AiMemoryReader.MAIL, in.memoryQuery()),
                shared.items(),
                shared.moreCount()));
    return new MailReplyDraft(r.draftBody());
  }

  /**
   * 초안 코칭(미영속): 내 초안을 톤·명료성(답장이면 완결성까지) 관점으로 코칭하고 개선본을 제시한다. ai_enabled=false 면 503, 타 계정이면 404.
   * 소유권·ai_enabled 게이트를 LLM 호출보다 먼저 통과시킨다.
   *
   * <p>소유권·ai_enabled·비서·스레드 조회만 짧은 읽기 트랜잭션({@link #readTx}, RLS GUC)에서 하고, 메모리 읽기(WP-381, 공통 +
   * 메일)와 LLM 호출은 그 뒤에 한다 — reply-draft 와 같은 이유.
   */
  public MailDraftCoaching coachDraft(long userId, MailDraftCoachingRequest req) {
    TxInput in =
        readTx.execute(
            s -> {
              // 소유권(404)·ai_enabled(503)·비서(503) 게이트 — 새 메일 초안과 공통.
              AiAccount acct = requireAiAccount(userId, req.accountId());
              // 답장이면 원문 스레드 동봉(소유 검증 포함), 새 메일이면 빈 리스트.
              List<ThreadMessage> thread =
                  req.inReplyToMessageId() == null
                      ? List.of()
                      : messageRepo.findThreadByIdAndUser(userId, req.inReplyToMessageId());
              // WP-383: 답장이면 원메일 제목 + 요약으로 메모리를 고른다(새 메일이면 질의 없음 — 고정 + 최신).
              String memoryQuery =
                  req.inReplyToMessageId() == null
                      ? null
                      : messageRepo
                          .findAiContextByIdAndUser(userId, req.inReplyToMessageId())
                          .map(MailAiService::memoryQuery)
                          .orElse(null);
              return new TxInput(acct.emailAddress(), acct.spec(), thread, memoryQuery);
            });
    // WP-386: 메일은 공간이 없어 조직 공용 메모리만(메모리 꺼짐과 무관).
    SharedMemories shared = SharedMemories.orEmpty(sharedReader.readForUser(userId, null, null));
    DraftCoachingResult r =
        mailClient.coachDraft(
            new DraftCoachingRequest(
                // WP-404: 초안은 HTML 로 넘긴다 — 텍스트(getText)는 문단 경계가 모두 \n\n 이 되어
                // 빈 줄·굵게·목록·링크 구조가 사라지고, 개선본이 원래 서식을 따를 수 없다. HTML 이 없을 때만 텍스트.
                req.bodyHtml() == null || req.bodyHtml().isBlank()
                    ? nz(req.bodyText())
                    : req.bodyHtml(),
                in.thread(),
                nz(in.selfAddress()),
                in.spec().agentUserId(),
                in.spec().model(),
                MAX_TURNS,
                in.spec().timeoutMs(),
                memoryReader.readForEntry(userId, AiMemoryReader.MAIL, in.memoryQuery()),
                shared.items(),
                shared.moreCount()));
    List<CoachingNote> notes =
        r.notes() == null
            ? List.of()
            : r.notes().stream().map(n -> new CoachingNote(n.dimension(), n.message())).toList();
    return new MailDraftCoaching(notes, nz(r.improvedBodyHtml()));
  }

  /**
   * 새 메일 AI 초안(WP-576, 미영속). 지시·받는사람·제목으로 평문 본문(제목이 비었으면 제목도)을 만든다. 타 계정이면 404, ai_enabled=false 면
   * 503(AI_DISABLED), 비서 미설정이면 503(ASSISTANT_NOT_CONFIGURED) — coachDraft 와 같은 게이트({@link
   * #requireAiAccount})를 LLM 호출보다 먼저 통과시킨다. 새 메일이라 스레드·메모리 질의가 없다(고정 + 최신 메모리). 에이전트가 빈 본문을 돌려주면
   * 502({@link MailAiException}).
   *
   * <p>소유권·ai_enabled·비서 해석과 보내는 사람 이름 조회는 짧은 읽기 트랜잭션({@link #readTx})에서 하고, 메모리 읽기와 LLM 호출은 그 뒤에
   * 한다 — coachDraft 와 같은 이유. 보내는 사람 이름은 맺음 인사("{이름} 드림")용이며 직함·연락처는 보내지 않는다.
   */
  public MailComposeDraft composeDraft(long userId, long accountId, MailComposeDraftRequest req) {
    // 게이트와 보내는 사람 이름(맺음 인사용)을 같은 읽기 트랜잭션에서 — 이름만 필요해 프로필 전체를 만들지 않는다.
    ComposeInput in =
        readTx.execute(
            s ->
                new ComposeInput(
                    requireAiAccount(userId, accountId),
                    peopleRepo
                        .findProfileBasics(userId)
                        .map(UserMailProfileBuilder::nameOf)
                        .orElse(null)));
    SharedMemories shared = SharedMemories.orEmpty(sharedReader.readForUser(userId, null, null));
    // 요청 제목이 있으면 그대로 두고 AI 는 제목을 만들지 않는다(응답 subject=null).
    boolean hasSubject = req.subject() != null && !req.subject().isBlank();
    ComposeDraftResult r =
        mailClient.composeDraft(
            new ComposeDraftRequest(
                req.instruction().strip(),
                req.to() == null ? List.of() : req.to(),
                req.cc() == null ? List.of() : req.cc(),
                hasSubject ? req.subject().strip() : "",
                nz(in.account().emailAddress()),
                in.senderName(),
                in.account().spec().agentUserId(),
                in.account().spec().model(),
                MAX_TURNS,
                in.account().spec().timeoutMs(),
                // 새 메일이라 메모리 질의가 없다(고정 + 최신)
                memoryReader.readForEntry(userId, AiMemoryReader.MAIL, null),
                shared.items(),
                shared.moreCount()));
    String body = nz(r.body());
    if (body.isBlank()) {
      // 빈 본문을 성공으로 돌려주면 사용자가 "초안이 비었다"를 결과로 오해한다 — 실패(502)로 알려 다시 시도하게 한다.
      throw new MailAiException("AI가 초안을 만들지 못했어요. 잠시 후 다시 시도해주세요.", null);
    }
    String aiSubject = r.subject() == null ? "" : r.subject().strip();
    return new MailComposeDraft(hasSubject || aiSubject.isEmpty() ? null : aiSubject, body);
  }

  /** 메모리 고르기 질의 상한(WP-383) — 제목 + 요약 앞부분이면 관련도를 매기기에 충분하다. */
  static final int MEMORY_QUERY_CHARS = 200;

  /** 메일 → 메모리 질의 — 개인 요약이 있으면 그것을, 없으면 공용 요약을 제목 뒤에 붙인다. */
  static String memoryQuery(AiContext ctx) {
    String summary =
        ctx.personalSummary() == null || ctx.personalSummary().isBlank()
            ? ctx.summary()
            : ctx.personalSummary();
    return memoryQuery(ctx.subject(), summary);
  }

  /** 제목 + 요약 앞 200자(WP-383 판정 5). 둘 다 비면 null — 리더가 고정 + 최신으로 고른다. */
  static String memoryQuery(String subject, String summary) {
    String q =
        ((subject == null ? "" : subject.strip()) + " " + (summary == null ? "" : summary.strip()))
            .strip();
    return q.isEmpty() ? null : Texts.headUtf16(q, MEMORY_QUERY_CHARS);
  }

  /** ai_enabled 게이트 — 꺼져 있으면 503(AI_DISABLED). */
  private void requireEnabled(boolean aiEnabled) {
    if (!aiEnabled) {
      throw MailAiUnavailableException.aiDisabled();
    }
  }

  private AssistantSpec requireSpec(long userId) {
    try {
      return assistantResolver.resolve(userId);
    } catch (Exception e) {
      throw MailAiUnavailableException.assistantNotConfigured();
    }
  }

  /**
   * 계정 기반 AI 호출(코칭·새 메일 초안)의 공통 게이트 — 소유권(타 계정/없음 404) → ai_enabled(503 AI_DISABLED) → 비서 사양(503
   * ASSISTANT_NOT_CONFIGURED) 순. 반드시 {@link #readTx} 안에서 부른다(RLS GUC).
   */
  private AiAccount requireAiAccount(long userId, long accountId) {
    EmailAccountResponse acct =
        accountRepo
            .findByIdAndUser(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    requireEnabled(acct.aiEnabled());
    return new AiAccount(acct.emailAddress(), requireSpec(userId));
  }

  /** 계정 게이트 통과 결과 — 계정 메일 주소와 비서 사양. */
  private record AiAccount(String emailAddress, AssistantSpec spec) {}

  /** 새 메일 초안의 트랜잭션 안 조회 결과 — 게이트 통과 계정 + 보내는 사람 이름(없으면 null). */
  private record ComposeInput(AiAccount account, String senderName) {}

  private String nz(String s) {
    return s == null ? "" : s;
  }

  /**
   * 답장 초안·초안 코칭의 트랜잭션 안 조회 결과 — 트랜잭션 밖 LLM 호출로 넘긴다. selfAddress 는 내 메일 주소(답장 초안은 그 메일의 수신 주소, 코칭은
   * 계정 주소).
   */
  private record TxInput(
      String selfAddress, AssistantSpec spec, List<ThreadMessage> thread, String memoryQuery) {}
}

package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.dto.MailReplyDraft;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.ClassifyRequest;
import com.workplace.mail.outbound.MailAiMessages.ClassifyResult;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftRequest;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftResult;
import com.workplace.mail.outbound.MailAiMessages.SummarizeRequest;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import com.workplace.mail.outbound.MailAiMessages.ThreadMessage;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 AI 오케스트레이션(7d): 분류(동기화 잡 best-effort)·요약(캐시)·답장 초안. 모든 경로는 계정 ai_enabled 게이트. 비서 사양은 home 과
 * 동일하게 AssistantResolver 로 해석(개인→공용, 미설정 시 분류 생략/요약·답장 503).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailAiService {

  /** 분류 허용 카테고리(미지 값은 폐기). */
  private static final Set<String> CATEGORIES = Set.of("업무", "개인", "알림", "프로모션", "뉴스레터");

  /** 단발 호출이라 turn 1 고정. */
  private static final int MAX_TURNS = 1;

  private final AiAgentMailClient mailClient;
  private final EmailMessageRepository messageRepo;
  private final AssistantResolver assistantResolver;

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
   * 메일 요약(캐시 우선). 캐시 없으면 ai-agent 호출 후 저장. ai_enabled=false 면 503.
   *
   * <p>RLS 도입 후 @Transactional(read-write) 필수 — app_tenant 런타임에서 GUC 미주입 시 첫 RLS 스코프 SELECT 가 빈 결과
   * → 거짓 404. updateSummary 캐시 쓰기를 동반하므로 read-write. <b>트레이드오프</b>: 캐시 미스 경로에서 LLM 호출(최대 90s) 동안 DB
   * 커넥션을 점유한다 — 짧은-트랜잭션(읽기/캐시쓰기를 분리한 별도 빈) 리팩터링은 후속 과제(#230 보고서 참조).
   */
  @Transactional
  public MailSummary summarize(long userId, long messageId) {
    AiContext ctx =
        messageRepo
            .findAiContextByIdAndUser(userId, messageId)
            .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
    requireEnabled(ctx);
    if (ctx.summary() != null && !ctx.summary().isBlank()) {
      return new MailSummary(ctx.summary());
    }
    AssistantSpec spec = requireSpec(userId);
    String body = ctx.bodyText() != null ? ctx.bodyText() : stripHtml(ctx.bodyHtml());
    SummarizeResult r =
        mailClient.summarize(
            new SummarizeRequest(
                nz(ctx.subject()),
                nz(ctx.fromAddress()),
                nz(body),
                spec.agentUserId(),
                spec.model(),
                MAX_TURNS,
                spec.timeoutMs()));
    messageRepo.updateSummary(messageId, r.summary());
    return new MailSummary(r.summary());
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

  /** 아주 단순한 HTML 태그 제거(요약 입력용). */
  private String stripHtml(String html) {
    return html == null ? "" : html.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
  }

  private String nz(String s) {
    return s == null ? "" : s;
  }
}

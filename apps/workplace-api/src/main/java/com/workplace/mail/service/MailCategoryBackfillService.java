package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchEntry;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchItem;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchRequest;
import com.workplace.mail.outbound.MailAiMessages.ClassifyBatchResult;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.ClassifyInput;
import com.workplace.mail.util.NewContentExtractor;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

/**
 * 받은편지함 전체 메일 카테고리 일괄 분류(WP-185).
 *
 * <p>③ 원본 분석은 회신필요 기준(최근 2일·안 읽음)에 묶여 있어 과거·읽은 메일은 열어 보기 전까지 미분류로 남는다. 이 서비스는 기간·읽음과 무관하게 미분류 메일을
 * 최신순으로 25통씩 묶어 분류 전용 호출(/mail/classify-batch)로 채운다 — 메일함 기본 보기(업무 + 미분류)의 미분류를 줄이기 위해서다.
 *
 * <p>저장 규칙: 기존 분류는 덮어쓰지 않고(fillContentCategoryIfEmpty), 응답을 받은 항목은 분류가 비어도 시도 시각을 남긴다(무한 재시도 방지).
 * 호출이 실패하면 아무것도 남기지 않아 다음 회차에 다시 고른다. LLM 은 트랜잭션 밖에서 부른다(#232).
 */
@Slf4j
@Service
public class MailCategoryBackfillService {

  /** 한 묶음 크기 — ai-agent 스키마 상한(25)과 같다. */
  public static final int BATCH_SIZE = 25;

  /** 계정당 한 회차 최대 묶음 수(100통) — 첫 연결 계정이 한 회차를 독점하지 않게. */
  public static final int MAX_BATCHES = 4;

  /** 분류 입력 본문 길이 — 제목·보낸사람과 앞부분이면 성격 판단에 충분하다. */
  public static final int BODY_HEAD_CHARS = 500;

  /** 분류는 단발 응답이다(③ 과 같은 MAX_TURNS). */
  private static final int MAX_TURNS = 1;

  private final EmailMessageRepository messageRepo;
  private final EmailAccountRepository accountRepo;
  private final AiAgentMailClient mailClient;
  private final AssistantResolver assistantResolver;
  private final NeedsReplyFinalizer finalizer;
  private final MailChangeNotifier notifier;
  private final TransactionTemplate txTemplate;

  public MailCategoryBackfillService(
      EmailMessageRepository messageRepo,
      EmailAccountRepository accountRepo,
      AiAgentMailClient mailClient,
      AssistantResolver assistantResolver,
      NeedsReplyFinalizer finalizer,
      MailChangeNotifier notifier,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.accountRepo = accountRepo;
    this.mailClient = mailClient;
    this.assistantResolver = assistantResolver;
    this.finalizer = finalizer;
    this.notifier = notifier;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 동기화 직후 비동기 진입점. TenantContext 전파 실패 시 RLS fail-closed 라 경고 후 skip. */
  @Async("aiAgentEventExecutor")
  public void classifyAccount(long userId, long accountId) {
    if (TenantContext.get() == null) {
      log.warn("분류 일괄 skip — TenantContext 없음 accountId={}", accountId);
      return;
    }
    classifyAccountNow(userId, accountId, new AgentOutageGuard());
  }

  /**
   * 동기 본체 — 최대 MAX_BATCHES 묶음. 비서가 없으면 아무것도 하지 않는다. 묶음 호출이 실패하면 이 계정은 여기서 멈춘다(같은 대상이 다시 골라지므로 같은
   * 회차에서 반복하지 않는다). agent 불가면 guard 에 기록해 호출부(스케줄러)가 남은 계정을 건너뛰게 한다.
   */
  public void classifyAccountNow(long userId, long accountId, AgentOutageGuard guard) {
    AssistantSpec spec = resolveSpec(userId, accountId);
    if (spec == null) {
      return;
    }
    for (int batch = 0; batch < MAX_BATCHES && !guard.tripped(); batch++) {
      List<Long> ids =
          txTemplate.execute(s -> messageRepo.listUncategorizedIds(accountId, BATCH_SIZE));
      if (ids == null || ids.isEmpty()) {
        return;
      }
      List<ClassifyInput> inputs =
          txTemplate.execute(s -> messageRepo.findClassifyInputs(accountId, ids));
      if (inputs == null || inputs.isEmpty()) {
        return;
      }
      ClassifyBatchResult result;
      try {
        result = mailClient.classifyBatch(request(inputs, spec));
      } catch (RuntimeException e) {
        if (MailAiException.isAgentUnavailable(e)) {
          guard.recordUnavailable();
          log.warn(
              "분류 일괄 실패(ai-agent 불가) accountId={}: {}", accountId, AgentOutageGuard.describe(e));
        } else {
          log.warn("분류 일괄 실패 accountId={} — 이번 회차 중단", accountId, e);
        }
        return;
      }
      if (result == null || result.results() == null) {
        return; // 형식이 비정상인 응답 — 기록하지 않고 다음 회차에 다시 고른다
      }
      guard.recordResponse();
      save(userId, accountId, inputs, result);
    }
  }

  /** 공통 비서 → (계정 AI 사용 시) 개인 비서. 둘 다 없으면 null. */
  private AssistantSpec resolveSpec(long userId, long accountId) {
    var workspace = assistantResolver.resolveWorkspaceOrEmpty();
    if (workspace.isPresent()) {
      return workspace.get();
    }
    boolean aiEnabled =
        Boolean.TRUE.equals(
            txTemplate.execute(
                s ->
                    accountRepo
                        .findByIdAndUser(userId, accountId)
                        .map(a -> a.aiEnabled())
                        .orElse(false)));
    return aiEnabled ? assistantResolver.resolvePersonalOrEmpty(userId).orElse(null) : null;
  }

  private static ClassifyBatchRequest request(List<ClassifyInput> inputs, AssistantSpec spec) {
    List<ClassifyBatchItem> items =
        inputs.stream()
            .map(
                in ->
                    new ClassifyBatchItem(
                        in.messageId(), sender(in), nz(in.subject()), bodyHead(in)))
            .toList();
    return new ClassifyBatchRequest(
        items, spec.agentUserId(), spec.model(), MAX_TURNS, spec.timeoutMs());
  }

  /** 자동 발송이면 ③ 처럼 미리보기를, 아니면 새로 쓴 본문을 앞 BODY_HEAD_CHARS 자로 자른다. 비면 빈 문자열. */
  static String bodyHead(ClassifyInput in) {
    String body =
        in.autoGenerated() && StringUtils.hasText(in.snippet())
            ? in.snippet()
            : NewContentExtractor.extract(in.bodyText(), in.bodyHtml(), in.snippet());
    String b = nz(body).trim();
    return b.length() > BODY_HEAD_CHARS ? b.substring(0, BODY_HEAD_CHARS) : b;
  }

  private static String sender(ClassifyInput in) {
    String addr = nz(in.fromAddress());
    return StringUtils.hasText(in.fromName()) ? in.fromName() + " <" + addr + ">" : addr;
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }

  /**
   * 결과 저장(한 트랜잭션) — 요청한 사본에 대한 결과만 쓴다(응답에 섞인 다른 id 는 무시). 분류를 새로 채운 content 는 회신필요 최종 판정을 다시 계산한다(③
   * 의 늦은 분류와 같은 규칙). 하나라도 채웠으면 소유자 화면을 무효화한다.
   */
  private void save(
      long userId, long accountId, List<ClassifyInput> inputs, ClassifyBatchResult result) {
    Map<Long, ClassifyInput> requested =
        inputs.stream().collect(Collectors.toMap(ClassifyInput::messageId, Function.identity()));
    List<Long> filledContents = new ArrayList<>();
    txTemplate.executeWithoutResult(
        s -> {
          for (ClassifyBatchEntry e : result.results()) {
            ClassifyInput in = requested.get(e.id());
            if (in == null) {
              continue;
            }
            String category = MailAnalysisService.validCategory(e.category());
            if (category != null
                && messageRepo.fillContentCategoryIfEmpty(in.messageId(), category)) {
              filledContents.add(in.contentId());
            }
            messageRepo.markCategorized(in.messageId());
          }
        });
    if (filledContents.isEmpty()) {
      return;
    }
    // 커밋 뒤 새 트랜잭션에서 ⑤ 를 다시 계산 — 동시에 도는 ③/④ 저장과 READ COMMITTED 로 겹쳐도 분류가 반영된 값으로 수렴한다
    // (MailAnalysisService 와 같은 규칙, 멱등·LLM 없음).
    // mailChanged 는 AFTER_COMMIT 리스너라 트랜잭션 안에서 발행해야 한다(밖에서 발행하면 유실).
    txTemplate.executeWithoutResult(
        s -> {
          filledContents.forEach(finalizer::recomputeForContent);
          notifier.mailChanged(userId, accountId, null, null);
        });
  }
}

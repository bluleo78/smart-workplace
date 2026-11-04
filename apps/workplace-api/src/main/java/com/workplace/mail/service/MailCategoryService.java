package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.ai.AiMemoryWriter;
import com.workplace.mail.dto.LearnMailCategoryResponse;
import com.workplace.mail.dto.MailCategoryChange;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.LearnCategoryRequest;
import com.workplace.mail.outbound.MailAiMessages.LearnCategoryResult;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AnalysisContext;
import com.workplace.mail.repository.EmailMessageRepository.CategoryState;
import com.workplace.mail.util.MailBodyText;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 분류 직접 바꾸기와 교정 학습(WP-1341).
 *
 * <p>바꾼 분류는 내 사본(email_message.user_category)에만 저장한다 — 공유 원본 분류를 바꾸면 같은 메일을 받은 동료에게 샌다. 바꾼 뒤 ⑤
 * 회신필요를 다시 계산하고(뉴스레터로 바꾸면 회신필요 차단) 열린 화면을 무효화한다.
 *
 * <p>학습은 개인 비서가 있고 계정 AI·AI 기억이 켜진 사용자만 한다. ai-agent 가 「왜 틀렸는지」를 일반화한 규칙 한 줄을 만들면(CREATE·UPDATE) 메일
 * 범위 기억으로 저장한다 — 그 기억은 ④ 개인 분석이 개인 비서 분류를 정할 때 읽는다. 학습 호출이 실패해도(구 ai-agent 404·모델 출력 오류 502 등) 분류
 * 변경은 이미 끝났으므로 NONE 으로 응답한다. LLM 은 트랜잭션 밖에서 부른다(#232).
 */
@Slf4j
@Service
public class MailCategoryService {

  /** 학습 입력 기억 상한 — ai-agent learnCategorySchema 의 memories 최대 개수와 같다. */
  static final int MAX_MEMORIES = 50;

  /** 학습 입력 본문 길이 — 분류 일괄과 같은 앞부분(제목·보낸 사람과 함께 성격 판단에 충분). */
  static final int BODY_HEAD_CHARS = MailCategoryBackfillService.BODY_HEAD_CHARS;

  /** 학습은 단발 응답이다. */
  private static final int MAX_TURNS = 1;

  static final String CREATE = "CREATE";
  static final String UPDATE = "UPDATE";

  private final EmailMessageRepository messageRepo;
  private final NeedsReplyFinalizer finalizer;
  private final MailChangeNotifier notifier;
  private final AssistantResolver assistantResolver;
  private final AiMemoryReader memoryReader;
  private final AiMemoryWriter memoryWriter;
  private final AiAgentMailClient mailClient;
  private final MailAnalysisService analysis;
  private final TransactionTemplate txTemplate;

  public MailCategoryService(
      EmailMessageRepository messageRepo,
      NeedsReplyFinalizer finalizer,
      MailChangeNotifier notifier,
      AssistantResolver assistantResolver,
      AiMemoryReader memoryReader,
      AiMemoryWriter memoryWriter,
      AiAgentMailClient mailClient,
      MailAnalysisService analysis,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.finalizer = finalizer;
    this.notifier = notifier;
    this.assistantResolver = assistantResolver;
    this.memoryReader = memoryReader;
    this.memoryWriter = memoryWriter;
    this.mailClient = mailClient;
    this.analysis = analysis;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 내 메일 분류를 바꾼다(null 이면 AI 분류로 되돌린다). 5종 밖이면 400, 본인 메일이 아니면 404.
   *
   * @return 바꾼 뒤 유효 분류·직접 분류 여부·이어서 학습할지
   */
  public MailCategoryChange setCategory(long userId, long messageId, String category) {
    if (category != null) {
      requireCategory(category, "분류는");
    }
    CategoryState before =
        txTemplate.execute(
            status -> {
              CategoryState state = requireState(userId, messageId);
              messageRepo.saveUserCategory(messageId, category);
              finalizer.recompute(messageId); // 유효 분류가 바뀌면 회신필요 차단도 바뀐다
              notifier.mailChanged(userId, state.accountId(), messageId, userId);
              return state;
            });
    if (category == null) {
      // 지웠을 때만 다시 읽는다(개인·공유 분류로 되돌아감). 되돌리기는 학습하지 않는다.
      CategoryState after = txTemplate.execute(status -> requireState(userId, messageId));
      return new MailCategoryChange(after.category(), after.categoryByMe(), false);
    }
    // 직접 정했으면 유효 분류는 그 값이라 다시 읽지 않는다. 실제로 바뀌었고 학습 조건을 만족할 때만 이어서 학습한다.
    boolean learnable =
        !category.equals(before.category()) && learnSpec(userId, before.aiEnabled()).isPresent();
    return new MailCategoryChange(category, true, learnable);
  }

  /**
   * 분류 교정 이유를 메일 기억 한 줄로 남긴다. 학습 조건(개인 비서 · 계정 AI · AI 기억 켬 · 바꾼 분류가 이전과 다름 · 내가 직접 정한 분류가 지금
   * toCategory)이 아니면 empty(컨트롤러가 204). ai-agent 실패·저장 실패는 NONE.
   *
   * <p>클라이언트가 보낸 from·to 만 믿지 않는다 — 실제로 바꾸지 않은 교정을 학습 요청만으로 기억에 남기지 못하게, 저장된 직접 분류가 toCategory 와 같을
   * 때만 학습한다. 가벼운 확인(같은 분류·상태·학습 조건)을 먼저 하고, 본문을 싣는 분석 컨텍스트는 학습이 진행될 때만 읽는다.
   */
  public Optional<LearnMailCategoryResponse> learn(
      long userId, long messageId, String fromCategory, String toCategory) {
    requireCategory(toCategory, "바꾼 분류는");
    if (fromCategory != null) {
      requireCategory(fromCategory, "바꾸기 전 분류는");
    }
    if (toCategory.equals(fromCategory)) {
      return Optional.empty(); // 바뀐 게 없다 — DB 를 읽지 않고 끝낸다
    }
    CategoryState state =
        txTemplate.execute(status -> requireState(userId, messageId)); // 본인 메일 아니면 404
    // 실제로 내가 그 분류로 바꿨는지 — 직접 분류가 없거나 다른 값이면 학습할 교정이 아니다
    if (!state.categoryByMe() || !toCategory.equals(state.category())) {
      return Optional.empty();
    }
    // 개인 비서는 한 번만 해석해 조건 확인과 학습 요청에 같이 쓴다
    AssistantSpec spec = learnSpec(userId, state.aiEnabled()).orElse(null);
    if (spec == null) {
      return Optional.empty();
    }
    AnalysisContext ctx = analysis.readContext(userId, messageId);
    if (ctx == null) {
      throw new EmailMessageNotFoundException(messageId);
    }
    // 트랜잭션 밖 — 기억 리더는 새 읽기 트랜잭션을 열고, LLM 호출 동안 커넥션을 쥐지 않는다.
    // 메일 범위 기억만 싣는다 — 공통 범위 기억(다른 앱에도 쓰이는 일반 기억)은 모델이 UPDATE 로 덮지 못하게 아예 보내지 않는다.
    // UPDATE id 검사(save)도 이 목록 기준이라 메일 기억만 고칠 수 있다.
    List<LearnCategoryRequest.Memory> memories =
        memoryReader.readAppScope(userId, AiMemoryReader.MAIL).stream()
            .limit(MAX_MEMORIES)
            .map(m -> new LearnCategoryRequest.Memory(m.id(), m.content()))
            .toList();
    LearnCategoryResult r;
    try {
      r =
          mailClient.learnCategory(
              new LearnCategoryRequest(
                  MailAnalysisService.nz(ctx.subject()),
                  MailAnalysisService.sender(ctx),
                  bodyHead(ctx),
                  fromCategory,
                  toCategory,
                  ctx.senderIsMember(),
                  memories,
                  spec.agentUserId(),
                  spec.model(),
                  MAX_TURNS,
                  spec.timeoutMs()));
    } catch (RuntimeException e) {
      // 구 ai-agent(404)·모델 출력 오류(502)·불가(503) — 분류 변경은 이미 끝났다. 학습만 건너뛴다(Review Focus 4).
      log.warn("메일 분류 학습 실패 — 기억 없이 끝냄 (messageId={}): {}", messageId, e.toString());
      return Optional.of(LearnMailCategoryResponse.NONE);
    }
    return Optional.of(save(userId, r, memories));
  }

  /** ai-agent 판단을 기억으로 저장한다. 형식이 틀렸거나(요청하지 않은 id 의 UPDATE 등) 저장하지 못하면 NONE. */
  private LearnMailCategoryResponse save(
      long userId, LearnCategoryResult r, List<LearnCategoryRequest.Memory> memories) {
    if (r == null || r.content() == null || r.content().isBlank()) {
      return LearnMailCategoryResponse.NONE;
    }
    if (CREATE.equals(r.action())) {
      return memoryWriter
          .createMailRule(userId, r.content())
          .map(s -> new LearnMailCategoryResponse(CREATE, s.id(), s.content(), null))
          .orElse(LearnMailCategoryResponse.NONE);
    }
    if (UPDATE.equals(r.action())
        && r.memoryId() != null
        && memories.stream().anyMatch(m -> Objects.equals(m.id(), r.memoryId()))) {
      return memoryWriter
          .updateContent(userId, r.memoryId(), r.content())
          .map(s -> new LearnMailCategoryResponse(UPDATE, s.id(), s.content(), s.previousContent()))
          .orElse(LearnMailCategoryResponse.NONE);
    }
    return LearnMailCategoryResponse.NONE;
  }

  /**
   * 학습 조건 — 개인 비서(공용 비서는 메모리가 없다) · 계정 AI 사용 · AI 기억 켬. 조건을 만족하면 그 개인 비서를 돌려준다(학습 요청에 다시 해석하지 않게).
   */
  private Optional<AssistantSpec> learnSpec(long userId, boolean accountAiEnabled) {
    if (!accountAiEnabled) {
      return Optional.empty();
    }
    return assistantResolver
        .resolvePersonalOrEmpty(userId)
        .filter(s -> memoryWriter.enabled(userId));
  }

  /** 분류 5종 검사 — 밖이면 400(label 은 「분류는」·「바꾼 분류는」처럼 어느 값인지 알리는 머리말). */
  private static void requireCategory(String value, String label) {
    if (value == null || !EmailMessageRepository.CATEGORIES.contains(value)) {
      throw new MailValidationException(label + " 업무·개인·알림·프로모션·뉴스레터 중 하나여야 해요.");
    }
  }

  private CategoryState requireState(long userId, long messageId) {
    return messageRepo
        .findCategoryState(userId, messageId)
        .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
  }

  /** 학습 입력 본문 — ③ 과 같은 규칙(자동 발송이면 미리보기, 아니면 새로 쓴 본문)의 앞 BODY_HEAD_CHARS 글자(코드 포인트 단위). */
  static String bodyHead(AnalysisContext ctx) {
    return MailBodyText.head(
        MailAnalysisService.bodyInput(ctx, MailAnalysisService.newBody(ctx)), BODY_HEAD_CHARS);
  }
}

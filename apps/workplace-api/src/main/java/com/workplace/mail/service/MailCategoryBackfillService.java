package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AgentOutageGuard;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 받은편지함 전체 메일 카테고리 일괄 분류(WP-185).
 *
 * <p>③ 원본 분석은 회신필요 기준(최근 2일·안 읽음)에 묶여 있어 과거·읽은 메일은 열어 보기 전까지 미분류로 남는다. 이 서비스는 기간·읽음과 무관하게 미분류 메일을
 * 최신순으로 25통씩 묶어 분류 전용 호출(/mail/classify-batch)로 채운다 — 메일함 기본 보기(업무 + 미분류)의 미분류를 줄이기 위해서다.
 *
 * <p>저장 규칙: 기존 분류는 덮어쓰지 않고(fillContentCategoryIfEmpty), 응답을 받은 항목은 분류가 비어도 시도 시각을 남긴다(무한 재시도 방지).
 * 호출이 실패하면 아무것도 남기지 않아 다음 회차에 다시 고른다 — 단, 단건 호출이 ai-agent 불가가 아닌 사유로 실패하면 그 메일이 입력 문제(독)임이 증명되므로 그
 * 한 통만 시도 처리해 영구 재시도로 회차를 막지 않게 한다(묶음 실패 시 단건 폴백, 아래 classifyAccountNow). LLM 은 트랜잭션 밖에서 부른다(#232).
 *
 * <p>진입점은 전용 스케줄러({@link MailCategoryBackfillScheduler}) 하나뿐이다 — 동기화 직후 {@code @Async} 로 부르지 않는다. 그
 * 실행기(aiAgentEventExecutor)는 채팅 AI 디스패치와 공유돼 동기화마다 무거운 LLM 일을 얹으면 고갈되고, 큐가 차면 TaskRejectedException
 * 이 동기화로 새어 나온다. 백로그 없는 계정은 회차 예산을 쓰지 않으므로 초기 드레인 뒤에는 모든 계정이 매 회차 닿아 새 메일은 약 한 주기(10분) 안에 분류된다(초기
 * 드레인 중에는 회차당 약 5개 계정씩 시작 위치를 돌려가며 — 스케줄러 참고). 최근 안 읽은 메일은 ③ 이 분류한다.
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

  /**
   * 동기 본체 — 최대 min(MAX_BATCHES, maxBatches) 묶음을 부르고, 실제로 부른 묶음 호출 수(실패 포함)를 돌려준다. 호출부(스케줄러)는 이 값으로
   * 회차 전체 묶음 예산을 깎는다 — 호출 하나가 최대 60초·LLM 비용 1회이므로 실패한 호출도 센다.
   *
   * <p>비서가 없으면 아무것도 하지 않는다(0). agent 불가(503·연결/읽기 타임아웃)면 guard 에 기록하고 아무것도 표시하지 않은 채 멈춘다 — 호출부가 남은
   * 계정을 건너뛴다. 그 외 사유의 실패(예: 특정 메일 때문에 항상 502)는 독 메일 하나가 계정의 나머지를 영원히 막지 않도록 처리한다. 2통 이상 묶음이 실패하면 이
   * 계정의 남은 회차를 1통씩 부르는 모드로 바꿔 계속하고(호출마다 예산·반환 호출 수에 센다), 1통 호출이 실패하면 그 메일이 독으로 증명된 것이므로 그 한 통만 시도
   * 시각을 남기고(분류는 null → 업무 보기에서 미분류) 경고 로그를 남긴 뒤 계속한다.
   */
  public int classifyAccountNow(
      long userId, long accountId, AgentOutageGuard guard, int maxBatches) {
    int limit = Math.min(MAX_BATCHES, maxBatches);
    if (limit <= 0) {
      return 0;
    }
    int[] calls = {0}; // 예외로 끝나도 실제로 부른 횟수를 돌려주기 위해 밖에서 센다
    try {
      runBatches(userId, accountId, guard, limit, calls);
    } catch (RuntimeException e) {
      // 계정 하나의 예기치 못한 실패(DB·저장 등)가 호출부를 깨지 않게 삼키고, 이미 부른 호출 수만 돌려 예산을 정확히 깎게 한다
      log.warn("분류 일괄 실패 accountId={}", accountId, e);
    }
    return calls[0];
  }

  /** 묶음 루프 본체 — 후보 id 를 계정당 한 번만 조회해 묶음 크기로 잘라 쓴다. calls[0] 에 부른 호출 수를 누적한다. */
  private void runBatches(
      long userId, long accountId, AgentOutageGuard guard, int limit, int[] calls) {
    // 백로그가 없는 계정은 비서·계정 조회 없이 바로 끝낸다(유휴 계정 비용 0)
    List<Long> candidates =
        txTemplate.execute(s -> messageRepo.listUncategorizedIds(accountId, limit * BATCH_SIZE));
    if (candidates == null || candidates.isEmpty()) {
      return;
    }
    AssistantSpec spec = resolveSpec(userId, accountId);
    if (spec == null) {
      return;
    }
    int batchSize = BATCH_SIZE; // 묶음 실패 뒤에는 1 로 줄어든다(독 메일 격리)
    int offset = 0; // 후보 목록에서 다음에 처리할 위치 — 묶음 실패 땐 그대로 두고 같은 메일을 단건으로 다시 부른다
    while (calls[0] < limit && !guard.tripped() && offset < candidates.size()) {
      List<Long> ids = candidates.subList(offset, Math.min(candidates.size(), offset + batchSize));
      List<ClassifyInput> inputs =
          txTemplate.execute(s -> messageRepo.findClassifyInputs(accountId, ids));
      if (inputs == null || inputs.isEmpty()) {
        return;
      }
      calls[0]++;
      ClassifyBatchResult result;
      try {
        result = mailClient.classifyBatch(request(inputs, spec));
      } catch (RuntimeException e) {
        int next = onClassifyFailure(accountId, guard, inputs, e);
        if (next == STOP) {
          return;
        }
        if (inputs.size() == 1) {
          offset += ids.size(); // 독 메일은 시도 처리됐으니 다음 후보로
        }
        batchSize = next;
        continue;
      }
      if (result == null || result.results() == null) {
        return; // 형식이 비정상인 응답 — 기록하지 않고 다음 회차에 다시 고른다
      }
      guard.recordResponse();
      save(userId, accountId, inputs, result);
      offset += ids.size();
    }
  }

  /** 묶음 호출 실패 처리 결과 — 회차를 멈추라는 신호. */
  private static final int STOP = -1;

  /**
   * 호출 실패 처리. agent 불가면 guard 에 기록하고 {@link #STOP}. 2통 이상 묶음 실패면 어느 메일이 문제인지 모르므로 다음부터 1통씩(1) 부른다.
   * 단건 실패는 (agent 불가가 아닌 사유라) 그 메일이 원인이므로 시도만 기록해 다시 고르지 않고 계속한다(1).
   */
  private int onClassifyFailure(
      long accountId, AgentOutageGuard guard, List<ClassifyInput> inputs, RuntimeException e) {
    if (MailAiException.isAgentUnavailable(e)) {
      guard.recordUnavailable();
      log.warn("분류 일괄 실패(ai-agent 불가) accountId={}: {}", accountId, AgentOutageGuard.describe(e));
      return STOP;
    }
    if (inputs.size() > 1) {
      log.warn("분류 일괄 실패 accountId={} — 단건 호출로 전환", accountId, e);
      return 1;
    }
    ClassifyInput poison = inputs.get(0);
    log.warn(
        "분류 단건 실패 — 해당 메일을 시도 처리하고 건너뜀 accountId={} messageId={}",
        accountId,
        poison.messageId(),
        e);
    txTemplate.executeWithoutResult(s -> messageRepo.markCategorized(poison.messageId()));
    return 1;
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
                        in.messageId(),
                        MailAnalysisService.sender(in.fromName(), in.fromAddress()),
                        MailAnalysisService.nz(in.subject()),
                        bodyHead(in)))
            .toList();
    return new ClassifyBatchRequest(
        items, spec.agentUserId(), spec.model(), MAX_TURNS, spec.timeoutMs());
  }

  /** ③ 과 같은 규칙으로 고른 본문(자동 발송이면 미리보기, 아니면 새로 쓴 본문)을 앞 BODY_HEAD_CHARS 자로 자른다. 비면 빈 문자열. */
  static String bodyHead(ClassifyInput in) {
    String body =
        MailAnalysisService.bodyFor(in.autoGenerated(), in.snippet(), in.bodyText(), in.bodyHtml());
    String b = MailAnalysisService.nz(body).trim();
    return b.length() > BODY_HEAD_CHARS ? b.substring(0, BODY_HEAD_CHARS) : b;
  }

  /**
   * 결과 저장(한 트랜잭션) — 요청한 사본에 대한 결과만 쓴다(응답에 섞인 다른 id 는 무시). 분류를 새로 채운 content 는 회신필요 최종 판정을 다시 계산한다(③
   * 의 늦은 분류와 같은 규칙). 하나라도 채웠으면 소유자 화면을 무효화한다.
   */
  private void save(
      long userId, long accountId, List<ClassifyInput> inputs, ClassifyBatchResult result) {
    Map<Long, ClassifyInput> requested =
        inputs.stream().collect(Collectors.toMap(ClassifyInput::messageId, Function.identity()));
    Set<Long> filledContents = new LinkedHashSet<>(); // 같은 content 중복 재계산 방지
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

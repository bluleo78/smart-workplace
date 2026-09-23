package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.action.ConfirmActionDispatcher;
import com.workplace.global.exception.ApiErrorDescriber;
import com.workplace.global.exception.ApiErrorDescriber.ApiError;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeProposalOutcome;
import com.workplace.home.dto.HomeProposalResponse;
import com.workplace.home.exception.HomeProposalAlreadyResolvedException;
import com.workplace.home.exception.HomeProposalNotFoundException;
import com.workplace.home.repository.HomeActionProposalRepository;
import com.workplace.home.repository.HomeActionProposalRepository.Row;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 홈 AI 채팅 확인카드(propose_*) 영속·승인·거부(#843).
 *
 * <p>예전엔 제안이 웹 state 에만 있어 새로고침 시 소실됐고, 승인 결과가 어디에도 남지 않아 AI 가 다음 턴에 성공/실패를 몰랐다. 이제 제안은 행으로 저장되고,
 * 승인·실패·거절은 모두 대화 이력(home_message, role=ACTION_*)에 한 줄로 기록돼 다음 턴 recentContext 로 AI 에게 전달된다 — 실패
 * 사유를 보고 파라미터를 고쳐 다시 제안(자가교정)할 수 있다.
 *
 * <p>승인은 트랜잭션 2단 구조다. 성공 경로(상태 DONE + 실행 + 결과 기록)는 한 트랜잭션이라 원자적이다. 실행이 예외로 끝나면 그 트랜잭션은 통째로 롤백되고(상태도
 * PENDING 으로 복귀), 이 메서드가 트랜잭션 <b>밖</b>에서 예외를 받아 별도 트랜잭션으로 FAILED + 실패 기록을 남긴다. 트랜잭션 안에서 잡지 않는 이유:
 * 도메인 예외가 이미 트랜잭션을 rollback-only 로 표시했을 수 있어 같은 트랜잭션에서 기록하면 UnexpectedRollbackException 으로 기록까지
 * 사라진다(#842 교훈). 기록 트랜잭션을 별도로 여는 이유: 비-트랜잭션 쓰기는 RLS GUC 가 없어 fail-closed 로 거부된다(#492/#444).
 */
@Service
public class HomeProposalService {

  static final String ROLE_DONE = "ACTION_DONE";
  static final String ROLE_FAILED = "ACTION_FAILED";
  static final String ROLE_REJECTED = "ACTION_REJECTED";

  /** 5xx(원인 불명)일 때 기록할 문구 — 캐치올의 영문 문구·내부 사정을 사용자·AI 에게 노출하지 않는다. */
  private static final String SERVER_ERROR_REASON = "서버 오류로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

  private final HomeActionProposalRepository proposalRepo;
  private final HomeSessionService sessionService;
  private final ConfirmActionDispatcher dispatcher;
  private final ApiErrorDescriber errorDescriber;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate txTemplate;

  public HomeProposalService(
      HomeActionProposalRepository proposalRepo,
      HomeSessionService sessionService,
      ConfirmActionDispatcher dispatcher,
      ApiErrorDescriber errorDescriber,
      ObjectMapper objectMapper,
      PlatformTransactionManager txManager) {
    this.proposalRepo = proposalRepo;
    this.sessionService = sessionService;
    this.dispatcher = dispatcher;
    this.errorDescriber = errorDescriber;
    this.objectMapper = objectMapper;
    // REQUIRES_NEW: 실행 트랜잭션과 실패 기록 트랜잭션이 반드시 서로 독립이어야 한다. 호출자 트랜잭션에 합류(REQUIRED)하면 실행
    // 실패의 부분 쓰기(상태 DONE)가 롤백되지 않은 채 기록 단계로 이어져 PENDING→FAILED 전이가 409 로 막힌다.
    this.txTemplate = new TransactionTemplate(txManager);
    this.txTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /**
   * ai-agent 가 발행한 제안 배열을 저장하고 id 가 붙은 응답을 돌려준다. 채팅 펌프 스레드에서 호출된다(GUC 는 TenantContextTaskDecorator
   * 가 전파).
   *
   * @param actions [{actionType, summary, params}] — ai-agent pending_action 이벤트 원문
   */
  @Transactional
  public List<HomeProposalResponse> record(long callerId, UUID sessionId, JsonNode actions) {
    sessionService.ensureOwner(callerId, sessionId);
    List<HomeProposalResponse> saved = new ArrayList<>();
    if (actions == null || !actions.isArray()) {
      return saved;
    }
    for (JsonNode a : actions) {
      JsonNode params =
          a.path("params").isMissingNode() ? objectMapper.createObjectNode() : a.get("params");
      Row row =
          proposalRepo.insert(
              sessionId,
              callerId,
              a.path("actionType").asText(),
              a.path("summary").asText(),
              params.toString());
      // 방금 직렬화한 params 를 다시 파싱하지 않고 원본 노드를 그대로 응답에 싣는다.
      saved.add(
          new HomeProposalResponse(
              row.id(), sessionId, row.actionType(), row.summary(), params, row.status(), null));
    }
    return saved;
  }

  /** 세션 복원용 — 아직 처리되지 않은 카드만. */
  @Transactional(readOnly = true)
  public List<HomeProposalResponse> listPending(long callerId, UUID sessionId) {
    sessionService.ensureOwner(callerId, sessionId);
    return proposalRepo.findPendingBySession(sessionId).stream().map(this::toResponse).toList();
  }

  /** 새 질문이 오면 이전 미처리 카드를 만료 — 기존 UX(새 질문 시 카드 비움)와 동일하되, 복원 시 되살아나지 않게 서버에도 반영. */
  @Transactional
  public void expirePending(long callerId, UUID sessionId) {
    sessionService.ensureOwner(callerId, sessionId);
    proposalRepo.expirePending(sessionId);
  }

  /**
   * 승인 — 실행 성공이면 DONE, 도메인 실패면 FAILED 로 기록하고 둘 다 200 결과로 돌려준다. 카드가 없거나(404) 이미 처리됐으면(409) 아무것도 기록하지
   * 않고 예외를 그대로 던진다.
   */
  public HomeProposalOutcome confirm(long callerId, long proposalId) {
    try {
      return txTemplate.execute(status -> confirmInTx(callerId, proposalId));
    } catch (HomeProposalNotFoundException | HomeProposalAlreadyResolvedException e) {
      throw e;
    } catch (RuntimeException e) {
      ApiError err = errorDescriber.describe(e);
      String reason =
          err.status() >= 500 || err.message() == null ? SERVER_ERROR_REASON : err.message();
      // 5xx 스택은 GlobalExceptionHandler 캐치올이 이미 남긴다(describe 가 그 핸들러를 호출).
      return txTemplate.execute(status -> recordFailure(callerId, proposalId, reason));
    }
  }

  /** 거부 — REJECTED 로 전이하고 "사용자가 거절" 을 이력에 남긴다(AI 가 같은 제안을 반복하지 않도록). */
  @Transactional
  public HomeProposalOutcome reject(long callerId, long proposalId) {
    Row row = requireOwned(callerId, proposalId);
    transition(row, HomeActionProposalRepository.REJECTED, null);
    HomeMessageResponse msg =
        sessionService.appendActionResult(
            callerId, row.sessionId(), ROLE_REJECTED, "사용자가 거절: " + row.summary());
    return outcome(row, HomeActionProposalRepository.REJECTED, null, msg);
  }

  /** 성공 경로 트랜잭션 — 상태를 먼저 DONE 으로 바꿔 행을 잠근 뒤 실행한다(동시 승인은 잠금 해제 후 0행 → 409). */
  private HomeProposalOutcome confirmInTx(long callerId, long proposalId) {
    Row row = requireOwned(callerId, proposalId);
    transition(row, HomeActionProposalRepository.DONE, null);
    Object result = dispatcher.confirm(callerId, row.actionType(), readJson(row.paramsJson()));
    HomeMessageResponse msg =
        sessionService.appendActionResult(
            callerId, row.sessionId(), ROLE_DONE, "승인 완료: " + row.summary() + resultRef(result));
    return outcome(row, HomeActionProposalRepository.DONE, null, msg);
  }

  /** 실패 기록 트랜잭션 — 실행 트랜잭션이 롤백돼 PENDING 으로 돌아온 행을 FAILED 로 전이하고 사유를 이력에 남긴다. */
  private HomeProposalOutcome recordFailure(long callerId, long proposalId, String reason) {
    Row row = requireOwned(callerId, proposalId);
    transition(row, HomeActionProposalRepository.FAILED, reason);
    HomeMessageResponse msg =
        sessionService.appendActionResult(
            callerId, row.sessionId(), ROLE_FAILED, "승인 실패: " + row.summary() + " — 사유: " + reason);
    return outcome(row, HomeActionProposalRepository.FAILED, reason, msg);
  }

  private Row requireOwned(long callerId, long proposalId) {
    return proposalRepo
        .findById(proposalId)
        .filter(r -> r.userId() == callerId)
        .orElseThrow(() -> new HomeProposalNotFoundException(proposalId));
  }

  private void transition(Row row, String status, String errorMessage) {
    if (!proposalRepo.resolve(row.id(), status, errorMessage)) {
      throw new HomeProposalAlreadyResolvedException(row.id());
    }
  }

  /** 전이 직후 응답 — 방금 조건부 UPDATE 로 바꾼 값(status·사유)을 행에 덮어써 재조회하지 않는다. */
  private HomeProposalOutcome outcome(
      Row row, String status, String errorMessage, HomeMessageResponse msg) {
    HomeProposalResponse r = toResponse(row);
    return new HomeProposalOutcome(
        new HomeProposalResponse(
            r.id(), r.sessionId(), r.actionType(), r.summary(), r.params(), status, errorMessage),
        msg);
  }

  /**
   * 실행 결과에서 후속 요청에 쓸 식별자를 뽑아 " (key: ABC-1)" · " (id: 42)" 형태로 붙인다. AI 가 "방금 만든 일정 옮겨줘" 같은 후속 요청을
   * 조회 없이 처리할 수 있게 하기 위함 — 식별자가 없으면 빈 문자열.
   */
  private String resultRef(Object result) {
    if (result == null) {
      return "";
    }
    JsonNode node = objectMapper.valueToTree(result);
    // 이슈(IssueResponse)는 key 필드가 없고 projectKey+number 로 식별된다 — AI 의 이슈 도구가 모두 issueKey(ABC-12)
    // 기준이라 내부 숫자 id 대신 이슈 키를 남긴다(#833: LLM 표면에 숫자 id 노출 금지).
    if (node.hasNonNull("projectKey") && node.hasNonNull("number")) {
      return " (key: " + node.get("projectKey").asText() + "-" + node.get("number").asText() + ")";
    }
    if (node.hasNonNull("key")) {
      return " (key: " + node.get("key").asText() + ")";
    }
    if (node.hasNonNull("id")) {
      return " (id: " + node.get("id").asText() + ")";
    }
    return "";
  }

  private HomeProposalResponse toResponse(Row r) {
    return new HomeProposalResponse(
        r.id(),
        r.sessionId(),
        r.actionType(),
        r.summary(),
        readJson(r.paramsJson()),
        r.status(),
        r.errorMessage());
  }

  private JsonNode readJson(String json) {
    try {
      return objectMapper.readTree(json);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("제안 params 역직렬화 실패", e);
    }
  }
}

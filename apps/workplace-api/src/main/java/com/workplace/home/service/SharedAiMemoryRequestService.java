package com.workplace.home.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.dto.SharedAiMemoryRequestBody;
import com.workplace.home.dto.SharedAiMemoryRequestResult;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.outbound.AiAgentSharedMemoryClient;
import com.workplace.home.outbound.SharedMemoryMessages.CheckRequest;
import com.workplace.home.outbound.SharedMemoryMessages.CheckResult;
import com.workplace.home.outbound.SharedMemoryMessages.Verdict;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.HomeSessionRepository;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.service.SharedAiMemoryService.Added;
import com.workplace.home.service.SharedMemorySpaces.Access;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공용 메모리 직접 요청(WP-386 스펙 6.2) — 「이건 이 프로젝트 규칙으로 기억해」. 3단: (1) 짧은 읽기 트랜잭션 — 내용·공간 해석·추가 권한·한도·비서,
 * (2) 트랜잭션 밖 — ai-agent 공용성 검사 동기 호출(DB 연결을 쥔 채 기다리지 않는다), (3) 짧은 쓰기 트랜잭션 — 사람 요청(USER_REQUESTED)으로
 * 저장·기록(공간 잠금·권한·한도 재확인 포함, {@link SharedAiMemoryService#insertLocked}). 불통과는 422(에이전트가 개인 메모리로
 * 돌린다), 검사 실패는 503(아무것도 저장하지 않는다). 요청한 사람은 내부 토큰의 대행 사용자이며 본문의 사용자 id 는 받지 않는다.
 */
@Service
public class SharedAiMemoryRequestService {

  /** 동기 검사 ai-agent 상한 — 클라이언트 읽기 15초 안에서 끝나게. */
  public static final int CHECK_TIMEOUT_MS = 12_000;

  /** 「지금 공간」을 뜻하는 말(빈 값 포함). */
  private static final Set<String> CURRENT = Set.of("", "current", "지금", "현재");

  /** 조직을 뜻하는 말 — 요청으로는 쓰지 못하므로 403 으로 안내한다. */
  private static final Set<String> ORG_WORDS = Set.of("org", "조직", "조직 지침");

  private final SharedMemorySpaces spaces;
  private final SharedAiMemoryRepository repo;
  private final SharedAiMemoryService memoryService;
  private final HomeSessionRepository sessionRepo;
  private final HomeMessageRepository messageRepo;
  private final AssistantResolver assistantResolver;
  private final AiAgentSharedMemoryClient client;
  private final TransactionTemplate tx;
  private final TransactionTemplate readTx;

  public SharedAiMemoryRequestService(
      SharedMemorySpaces spaces,
      SharedAiMemoryRepository repo,
      SharedAiMemoryService memoryService,
      HomeSessionRepository sessionRepo,
      HomeMessageRepository messageRepo,
      AssistantResolver assistantResolver,
      AiAgentSharedMemoryClient client,
      PlatformTransactionManager txManager) {
    this.spaces = spaces;
    this.repo = repo;
    this.memoryService = memoryService;
    this.sessionRepo = sessionRepo;
    this.messageRepo = messageRepo;
    this.assistantResolver = assistantResolver;
    this.client = client;
    this.tx = new TransactionTemplate(txManager);
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
  }

  /** 1단 결과 — 해석된 공간과 검사에 쓸 비서. */
  private record Plan(SharedSpace space, AssistantSpec spec) {}

  /** 직접 요청 처리 — 저장되면 결과(기록 id 포함), 아니면 SharedAiMemoryException(400·403·404·409·422·503). */
  public SharedAiMemoryRequestResult request(long userId, SharedAiMemoryRequestBody body) {
    String content = SharedAiMemoryService.normalizeContent(body == null ? null : body.content());
    Plan plan = readTx.execute(s -> plan(userId, body));
    SharedSpace space = plan.space();
    CheckResult verdict;
    try {
      verdict =
          client.checkNow(
              new CheckRequest(
                  plan.spec().agentUserId(),
                  plan.spec().suggestionModel(),
                  CHECK_TIMEOUT_MS,
                  space.type().name(),
                  space.label(),
                  List.of(content)));
    } catch (MemoryCleanupAiException e) {
      // 시간 초과·ai-agent 불가 모두 「검사를 못 함」 — 공용에도 개인에도 저장하지 않는다.
      throw SharedAiMemoryException.checkUnavailable();
    }
    // 스펙 6.4 — 형식이 깨진 결과(없음·개수 불일치·빈 항목·빈 본문)는 「검사를 못 함」이다. 개인적이라는 판정(422)으로 보내면 에이전트가 개인 메모리로
    // 돌려 저장하므로, 온전한 판정이 불통과일 때만 422.
    List<Verdict> results = verdict == null ? null : verdict.results();
    if (results == null || results.size() != 1 || results.get(0) == null) {
      throw SharedAiMemoryException.checkUnavailable();
    }
    if (!results.get(0).passed()) throw SharedAiMemoryException.personal();
    return tx.execute(s -> save(userId, space.spaceKey(), content));
  }

  /** 1단 — 공간 해석(읽기 권한 확인 포함)·추가 권한·한도·비서. 조직은 요청으로 쓰지 못한다(관리자가 설정에서 직접 추가). */
  private Plan plan(long userId, SharedAiMemoryRequestBody body) {
    Access a = resolve(userId, body);
    SharedSpace space = a.space();
    if (!a.canAdd()) throw SharedAiMemoryException.forbidden("이 공간에 추가할 권한이 없어요.");
    // 가득 찬 공간은 검사 호출 전에 거절한다(헛된 AI 호출 방지) — 저장 때 잠금 안에서 다시 본다.
    int limit = SharedAiMemoryRepository.limitOf(space.spaceKey());
    if (repo.count(space.spaceKey()) >= limit) throw SharedAiMemoryException.full(limit);
    AssistantSpec spec =
        assistantResolver
            .resolveOrEmpty(userId)
            .orElseThrow(SharedAiMemoryException::checkUnavailable);
    return new Plan(a.space(), spec);
  }

  /**
   * 공간 해석 — 비었거나 "current" 면 요청자 본인 대화의 지금 공간(마지막 사용자 메시지에 서버가 검증해 둔 공간), 아니면 읽을 수 있는 공간 중 키·이름이
   * 정확히 하나 맞는 곳(여럿이면 추가할 수 있는 하나). 맞은 공간에 추가 권한이 없으면 403.
   */
  private Access resolve(long userId, SharedAiMemoryRequestBody body) {
    String arg = body.space() == null ? "" : body.space().strip();
    String lower = lower(arg);
    // 조직 말이 프로젝트 키 「ORG」보다 먼저 맞는다(의도된 규칙) — 조직은 요청으로 쓰지 못한다.
    if (ORG_WORDS.contains(lower)) throw orgForbidden();
    if (CURRENT.contains(lower)) {
      SpaceKey k =
          body.sessionId() == null
              ? null
              : sessionRepo
                  .findById(body.sessionId())
                  .filter(r -> r.userId() == userId)
                  .flatMap(r -> messageRepo.latestUserSpace(body.sessionId()))
                  .orElse(null);
      if (k == null) {
        throw SharedAiMemoryException.spaceUnresolved(
            "지금 화면이 프로젝트나 노트 스페이스가 아니에요. 어느 공간에 기억할지 알려 주세요.");
      }
      Access a = spaces.requireReadable(userId, k);
      if (a.space().type() == SharedSpace.Type.ORG) throw orgForbidden();
      return a;
    }
    // 읽을 수 있는 공간(조직 제외)에서 먼저 찾고, 추가 권한은 그 뒤에 본다 — 읽을 수는 있지만 추가할 수 없는 공간을 말하면 "못 찾음" 이 아니라 403 으로
    // 알린다.
    List<Access> readable =
        spaces.readable(userId).stream()
            .filter(a -> a.space().type() != SharedSpace.Type.ORG)
            .toList();
    List<Access> matched =
        readable.stream()
            .filter(
                a ->
                    lower.equals(lower(a.space().key()))
                        || lower.equals(lower(a.space().name()))
                        || lower.equals(lower(a.space().label())))
            .toList();
    // 이름이 여럿에 맞으면 추가할 수 있는 쪽으로 좁힌다(종전 동작 — 추가 가능한 하나만 맞으면 그곳).
    if (matched.size() > 1) {
      List<Access> addableMatched = matched.stream().filter(Access::canAdd).toList();
      if (addableMatched.size() == 1) matched = addableMatched;
    }
    if (matched.size() == 1) {
      Access only = matched.get(0);
      if (!only.canAdd()) {
        throw SharedAiMemoryException.forbidden("'" + only.space().label() + "' 공간에는 추가할 권한이 없어요.");
      }
      return only;
    }
    String names =
        (matched.isEmpty() ? readable.stream().filter(Access::canAdd).toList() : matched)
            .stream().limit(5).map(a -> a.space().label()).collect(Collectors.joining(", "));
    throw SharedAiMemoryException.spaceUnresolved(
        (matched.isEmpty() ? "'" + arg + "' 공간을 찾지 못했어요." : "여러 공간이 맞아요.")
            + (names.isEmpty() ? "" : " 추가할 수 있는 공간: " + names));
  }

  private static SharedAiMemoryException orgForbidden() {
    return SharedAiMemoryException.forbidden("조직 지침은 관리자가 설정에서 직접 추가해요.");
  }

  private static String lower(String s) {
    return s == null ? null : s.toLowerCase(Locale.ROOT);
  }

  /** 3단 — 잠금 뒤 재확인·저장·기록은 공용 삽입 경로가 맡는다. 결과의 공간 라벨은 저장 시점 권한에서 읽는다. */
  private SharedAiMemoryRequestResult save(long userId, SpaceKey k, String content) {
    Added added = memoryService.insertLocked(userId, k, content, "USER_REQUESTED");
    return new SharedAiMemoryRequestResult(
        added.changeId(),
        added.row().id(),
        k.type(),
        k.id(),
        added.access().space().label(),
        content);
  }
}

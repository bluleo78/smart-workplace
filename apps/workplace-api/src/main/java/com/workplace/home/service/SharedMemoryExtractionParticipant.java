package com.workplace.home.service;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.global.ai.TextEmbedder;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.outbound.AiAgentSharedMemoryClient;
import com.workplace.home.outbound.HomeChatConfig;
import com.workplace.home.outbound.SharedMemoryMessages.CheckRequest;
import com.workplace.home.outbound.SharedMemoryMessages.CheckResult;
import com.workplace.home.outbound.SharedMemoryMessages.ExtractRequest;
import com.workplace.home.outbound.SharedMemoryMessages.MemoryRef;
import com.workplace.home.outbound.SharedMemoryMessages.Op;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.service.SessionCleanupInput.Utterance;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 대화가 끝난 뒤 공용 메모리 자동 추출·정리(WP-386 스펙 6.3) — WP-385 배경 정리의 세션 훅. 세션의 새 사용자 발화 중 화면 공간이 남은 것을 공간별로
 * 묶어, 공간마다 (발화자가 지금도 추가 권한이 있으면) ai-agent 추출 → 별도 공용성 검사 → 결과 임베딩을 트랜잭션 밖에서 준비하고, 적용은 개인 정리와 같은
 * 트랜잭션에서 {@link SharedMemoryOpApplier} 가 한다.
 *
 * <p>발화자 추적 금지: 발화자 id 는 권한 확인에만 메모리 안에서 쓰고, ai-agent 요청(발화 문장·공간 이름뿐)·저장·기록·로그 어디에도 싣지 않는다. 로그는
 * 공간(종류:id)·건수·예외 클래스 이름만 남긴다(내용·예외 메시지 없음).
 *
 * <p>실패: ai-agent 연결 실패·503·404 는 MemoryCleanupAiException 으로 다시 던져 세션을 다음 회차로 미룬다(WP-385 계약 — 읽기
 * 시간 초과는 제외). 그 밖의 추출 실패(502·읽기 시간 초과)는 그 공간만 건너뛰고, 검사 실패는 그 묶음 후보의 불통과다. 형식이 깨진 AI 출력은 그 op 만 버린다.
 */
@Slf4j
@Component
public class SharedMemoryExtractionParticipant implements SessionCleanupParticipant {

  /** 검사 한 번의 후보 상한(스펙 6.4). */
  static final int CHECK_BATCH = 10;

  /**
   * 공간 하나에서 받아들이는 내용 op(ADD·UPDATE·MERGE) 상한 — 공용성 검사가 10개씩이라 최대 2번. 공간 하나의 최악은 {@link
   * #spaceWorst()} 이고, 공간 수에는 상한이 없으므로 공간마다 시작 전에 회차 마감을 확인한다(WP-2111). 넘는 op 는 검사·임베딩 전에
   * 버린다(FORGET 은 세지 않는다).
   */
  static final int MAX_CONTENT_OPS = 20;

  private static final Set<String> CONTENT_OPS = AiMemoryCleanupScheduler.CONTENT_OPS;

  private static final Set<String> OPS = Set.of("ADD", "UPDATE", "MERGE", "FORGET");

  /** 한 공간의 준비 결과 — seen 은 추출 때 본 공간 행(적용 시 updated_at 동등 비교의 기준). */
  public record SpacePlan(
      SharedSpace space, List<Row> seen, List<Op> ops, Map<String, float[]> vectors) {}

  private final HomeMessageRepository messages;
  private final SharedMemorySpaces spaces;
  private final SharedAiMemoryRepository repo;
  private final AiAgentSharedMemoryClient client;
  private final TextEmbedder embedder;
  private final SharedMemoryOpApplier applier;
  private final TransactionTemplate readTx;
  private final TransactionTemplate spaceTx;

  /** AI 호출 실행 상한 표(WP-2111). */
  private final AiCallTimeouts timeouts;

  /** 공간 하나의 최악 시간 — 생성 때 한 번 계산한다(실행 상한 표는 기동 뒤 바뀌지 않는다). */
  private final Duration spaceWorst;

  public SharedMemoryExtractionParticipant(
      HomeMessageRepository messages,
      SharedMemorySpaces spaces,
      SharedAiMemoryRepository repo,
      AiAgentSharedMemoryClient client,
      TextEmbedder embedder,
      SharedMemoryOpApplier applier,
      PlatformTransactionManager txManager,
      AiCallTimeouts timeouts) {
    this.timeouts = timeouts;
    this.spaceWorst = computeSpaceWorst(timeouts);
    this.messages = messages;
    this.spaces = spaces;
    this.repo = repo;
    this.client = client;
    this.embedder = embedder;
    this.applier = applier;
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
    // 공간 하나의 적용을 세이브포인트로 감싼다 — WP-385 적용 트랜잭션 안에서 NESTED 로 합류한다(DataSourceTransactionManager 계열).
    this.spaceTx = new TransactionTemplate(txManager);
    this.spaceTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  /**
   * 공간 하나의 최악 시간 — 추출 1번 + 검사 최대 2번(각각 배경 클라이언트 읽기 상한) + 결과 임베딩(op 상한 × 5초). 읽기 상한은 실행 상한 + 여유라 덮어쓴
   * 값을 따른다.
   */
  Duration spaceWorst() {
    return spaceWorst;
  }

  /**
   * 처리 단위 = 공간 하나 — 스케줄러가 정리 호출 전에 마감을 볼 때 쓴다(WP-2111 리뷰 후속). 이 세션에 추출할 공간 발화가 없으면 0 이다 — 공간 없는
   * 세션까지 spaceWorst 를 더하면 일 없는 세션도 미뤄 회차가 끊긴다. 공간 묶기(DB 읽기)가 실패해도 0 이다 — 그때 {@link #prepare} 도 할 일
   * 없음으로 끝난다.
   */
  @Override
  public Duration unitWorst(SessionCleanupInput input) {
    try {
      Map<SpaceKey, List<Utterance>> bySpace = readTx.execute(s -> group(input));
      return bySpace == null || bySpace.isEmpty() ? Duration.ZERO : spaceWorst;
    } catch (RuntimeException e) {
      return Duration.ZERO;
    }
  }

  private static Duration computeSpaceWorst(AiCallTimeouts timeouts) {
    // 추출·검사가 같은 배경 클라이언트라 호출 하나의 최악은 그 클라이언트의 실제 읽기 상한(둘 중 큰 상한 + 여유)이다.
    Duration perCall = HomeChatConfig.sharedMemorySlowReadTimeout(timeouts);
    return perCall
        .multipliedBy(3)
        .plus(AiMemoryCleanupScheduler.RESULT_EMBED_WAIT.multipliedBy(MAX_CONTENT_OPS));
  }

  /**
   * 공간별 준비(트랜잭션 밖) — 할 일이 있는 공간의 계획만 모아, 적용은 같은 트랜잭션 안에서 한다. 공간마다 시작 전에 {@link #spaceWorst()} 가 회차
   * 마감 안에 들어가는지 본다(WP-2111).
   *
   * <p>마감에 걸리면(WP-2111 재검토 — 건너뛴 공간의 발화를 잃지 않게):
   *
   * <ul>
   *   <li>미루는 예산(회차 첫 세션이 아님) — {@link DeadlineReached} 를 던져 세션을 통째로 다음 회차로 미룬다(경계 그대로).
   *   <li>미루지 않는 예산(회차 첫 세션) — 처리한 공간까지만 진행한 것으로 기록한다: 건너뛴 첫 공간의 첫 발화 바로 앞까지만 경계를 올리게 {@link
   *       Prepared#uptoLimit()} 를 싣는다. 공간은 첫 발화 순으로 돌므로 건너뛴 공간의 발화는 모두 그 뒤에 있고, 다음 회차는 그 발화부터 다시 모아
   *       건너뛴 공간을 맨 앞에서 추출한다 — 회차마다 적어도 한 공간씩 나아가 무한히 미뤄지지 않는다. 처리한 공간의 발화 중 그 뒤에 있던 것은 다음 회차에 한 번
   *       더 보이지만, 추출은 공간의 기존 행을 함께 받아 같은 내용을 다시 넣지 않는다(개인 정리도 같은 구간을 다시 보지만 기존 메모리와 비교한다).
   *   <li>첫 세션인데 공간 하나도 못 끝낸다면(덮어쓴 상한이 매우 커 남은 시간이 공간 최악보다 짧음) 진행한 것이 없으므로 던져서 미룬다.
   * </ul>
   *
   * <p>고른 이유: 공간 처리 위치를 따로 저장하는 길(스키마 추가)보다 기존 경계 하나로 「여기까지 했다」를 나타내는 편이 단순하고, 경계가 다른 회차·파드와의 조건부
   * 갱신을 이미 맡고 있어 새 동시성 규칙이 필요 없다.
   */
  @Override
  public Prepared prepare(SessionCleanupInput in, SpaceBudget budget) {
    Map<SpaceKey, List<Utterance>> bySpace;
    try {
      bySpace = readTx.execute(s -> group(in));
    } catch (RuntimeException e) {
      // 공간 묶기(DB 읽기)가 깨져도 던지지 않는다 — 던지면 WP-385 개인 정리 결과까지 회차 실패로 버려진다. 로그는 예외 클래스 이름만.
      log.warn("공용 메모리 공간 묶기 실패 — 이 세션의 공용 추출 건너뜀: 원인={}", e.getClass().getSimpleName());
      return Prepared.NONE;
    }
    if (bySpace == null || bySpace.isEmpty()) return Prepared.NONE;
    List<SpacePlan> plans = new ArrayList<>();
    Duration worst = spaceWorst;
    int done = 0;
    // 건너뛴 공간이 있으면 경계를 올릴 수 있는 최대(건너뛴 첫 공간의 첫 발화 바로 앞) — 없으면 null(수집 때의 마지막 메시지까지).
    Long uptoLimit = null;
    for (Map.Entry<SpaceKey, List<Utterance>> e : bySpace.entrySet()) {
      if (!budget.deadline().allows(worst)) {
        if (budget.deferOnOverrun() || done == 0) {
          // 세션을 통째로 다음 회차로 — 경계를 올리지 않으므로 남은 공간의 발화도 다음 회차가 다시 본다.
          throw new DeadlineReached("공용 메모리 추출 — 회차 마감 전에 다음 공간을 끝낼 수 없음");
        }
        // 회차 첫 세션 — 처리한 공간까지만 진행으로 기록한다. 공간은 첫 발화 순이라 이 공간의 첫 발화가 건너뛴 발화 중 가장 앞이다.
        uptoLimit = e.getValue().get(0).messageId() - 1;
        log.warn("공용 메모리 추출 회차 마감 — 남은 공간 {}개는 다음 회차에(공간 {}개 처리)", bySpace.size() - done, done);
        break;
      }
      done++;
      SpacePlan p;
      try {
        p = prepareSpace(in, e.getKey(), e.getValue().stream().map(Utterance::text).toList());
      } catch (MemoryCleanupAiException ex) {
        throw ex; // prepareSpace 가 다시 던지는 건 ai-agent 장애뿐 — 세션을 다음 회차로 미루는 기존 규칙.
      } catch (RuntimeException ex) {
        // 읽기 트랜잭션(DB)·예상 밖 오류 — 그 공간만 건너뛴다. 격리하지 않으면 개인 정리 결과까지 회차 실패로 세어 3회 뒤 영영 잃는다.
        log.warn(
            "공용 메모리 추출 준비 실패 — 이 공간 건너뜀: space={} 원인={}",
            e.getKey().param(),
            ex.getClass().getSimpleName());
        continue;
      }
      if (p != null && !p.ops().isEmpty()) plans.add(p);
    }
    // 공간 잠금을 항상 같은 순서로 잡아 다른 회차와 교착하지 않게 한다.
    plans.sort(Comparator.comparing(p -> p.space().param()));
    long speakerId = in.userId(); // 적용 때 권한 재확인에만 쓴다 — 어디에도 저장하지 않는다.
    Prepared apply =
        plans.isEmpty() ? Prepared.NONE : () -> plans.forEach(p -> applyIsolated(speakerId, p));
    // 건너뛴 공간이 있으면 처리한 계획이 없어도 경계 상한은 실어야 한다 — 안 그러면 경계가 끝까지 올라 건너뛴 발화를 잃는다.
    return uptoLimit == null ? apply : Prepared.limitedTo(uptoLimit, apply);
  }

  /**
   * 공간 하나의 적용을 격리한다 — 세이브포인트 안에서 실행하고, 예상 밖 RuntimeException(SQL·pgvector 등)이면 그 공간만 되돌린 채 로그만 남기고
   * 다음 공간으로 간다. 격리하지 않으면 한 공간의 오류가 개인 정리·다른 공간·경계 갱신까지 한 트랜잭션째 되돌려 3회 뒤 이 세션의 정리를 영영 잃는다. 로그는 공간과
   * 예외 클래스 이름만(메시지에 내용이 섞일 수 있다).
   */
  private void applyIsolated(long speakerId, SpacePlan p) {
    try {
      spaceTx.executeWithoutResult(s -> applier.apply(speakerId, p));
    } catch (RuntimeException e) {
      log.warn(
          "공용 메모리 적용 실패 — 이 공간만 되돌림: space={} 원인={}",
          p.space().param(),
          e.getClass().getSimpleName());
    }
  }

  /**
   * 발화 → 공간별 묶음(발화 순서 유지, 공간은 첫 발화 순 — 마감에 걸렸을 때 경계 상한 계산이 이 순서에 기댄다). 공간 없는 발화와 조직 지침 화면(조직은 관리자가
   * 직접 쓴다)은 빠진다.
   */
  private Map<SpaceKey, List<Utterance>> group(SessionCleanupInput in) {
    Map<Long, SpaceKey> spaceOf =
        messages.spacesOf(in.utterances().stream().map(Utterance::messageId).toList());
    Map<SpaceKey, List<Utterance>> out = new LinkedHashMap<>();
    for (Utterance u : in.utterances()) {
      SpaceKey k = spaceOf.get(u.messageId());
      if (k == null || "ORG".equals(k.type())) continue;
      out.computeIfAbsent(k, x -> new ArrayList<>()).add(u);
    }
    return out;
  }

  /** 한 공간 준비 — 권한 → 추출 → 모양 검사 → 공용성 검사 → 임베딩. 할 일이 없거나 건너뛰면 null. */
  private SpacePlan prepareSpace(SessionCleanupInput in, SpaceKey k, List<String> utterances) {
    record Seen(SharedSpace space, List<Row> rows) {}
    Seen seen =
        readTx.execute(
            s ->
                spaces
                    .access(in.userId(), k)
                    .filter(SharedMemorySpaces.Access::canAdd)
                    .map(a -> new Seen(a.space(), repo.all(k)))
                    .orElse(null));
    if (seen == null) {
      log.debug("공용 메모리 추출 건너뜀(추가 권한 없음): space={}", k.param());
      return null;
    }
    List<Op> raw;
    try {
      raw =
          client
              .extract(
                  new ExtractRequest(
                      in.spec().agentUserId(),
                      in.spec().suggestionModel(),
                      timeouts.timeoutMs(AiCall.HOME_SHARED_MEMORY_EXTRACT),
                      in.today().toString(),
                      k.type(),
                      seen.space().label(),
                      utterances,
                      seen.rows().stream()
                          .map(r -> new MemoryRef(r.id(), r.content(), originForAi(r)))
                          .toList()))
              .ops();
    } catch (MemoryCleanupAiException e) {
      rethrowIfOutage(e);
      log.warn("공용 메모리 추출 실패 — 이 공간 건너뜀: space={} 원인={}", k.param(), causeName(e));
      return null;
    }
    List<Op> shaped = shape(raw, utterances.size());
    Set<String> passed = check(in, seen.space(), shaped);
    List<Op> kept =
        shaped.stream()
            .filter(o -> !CONTENT_OPS.contains(o.op()) || passed.contains(o.content()))
            .toList();
    Map<String, float[]> vectors = new HashMap<>();
    for (Op o : kept) {
      String t = o.content();
      if (CONTENT_OPS.contains(o.op()) && !vectors.containsKey(t)) {
        embedder
            .embedQuery(t, AiMemoryCleanupScheduler.RESULT_EMBED_WAIT)
            .ifPresent(v -> vectors.put(t, v));
      }
    }
    log.debug(
        "공용 메모리 추출 준비: space={} 발화={} op={} 통과={}",
        k.param(),
        utterances.size(),
        raw.size(),
        kept.size());
    return new SpacePlan(seen.space(), seen.rows(), kept, vectors);
  }

  /**
   * ai-agent 에 알리는 출처 — 사람이 고친 AI 항목(updated_by 있음)은 사람 항목으로 알린다. ai-agent 는 AI_ 로 시작하지 않는 출처를 "사람이
   * 씀 · 바꾸지 말 것" 으로 표시하므로(계약은 그대로) 모델이 대상으로 고르지 않는다 — 서버도 {@link SharedMemoryOpApplier} 에서 한 번 더
   * 거른다.
   */
  private static String originForAi(Row r) {
    if (SharedMemorySpaces.aiOwned(r.origin(), r.updatedBy())) return r.origin();
    return SharedMemorySpaces.AI_ORIGINS.contains(r.origin()) ? "USER_ADDED" : r.origin();
  }

  /**
   * AI 출력의 모양 검사 — 알 수 없는 op·근거 번호가 발화 범위 밖인 op·내용 op 의 빈/300자 초과 문장·상한({@link #MAX_CONTENT_OPS}) 밖
   * 내용 op 는 버린다. 내용 op 의 문장은 제어문자를 걷고 앞뒤 공백을 지운 값으로 바꿔 돌려준다(이후 검사·임베딩·저장이 같은 문장을 쓴다). 던지지 않는다.
   */
  static List<Op> shape(List<Op> ops, int utteranceCount) {
    List<Op> out = new ArrayList<>();
    int contentOps = 0;
    for (Op o : ops == null ? List.<Op>of() : ops) {
      if (o == null || o.op() == null || !OPS.contains(o.op())) continue;
      Integer ev = o.evidence();
      if (ev == null || ev < 0 || ev >= utteranceCount) continue;
      if (!CONTENT_OPS.contains(o.op())) {
        out.add(o);
        continue;
      }
      if (contentOps >= MAX_CONTENT_OPS) continue; // 상한 밖 내용 op 는 검사·임베딩 전에 버린다.
      try {
        out.add(
            new Op(
                o.op(),
                o.targetIds(),
                SharedAiMemoryService.normalizeContent(o.content()),
                ev,
                o.reason()));
        contentOps++;
      } catch (SharedAiMemoryException e) {
        // 문장이 비었거나 300자를 넘는다 — 그 op 만 버린다.
      }
    }
    return out;
  }

  /** 내용 op 결과 문장을 10개씩 검사 — 통과한 문장 집합. 호출 실패·형식 깨짐은 그 묶음 전부 불통과(에이전트 불가는 세션을 미룬다). */
  private Set<String> check(SessionCleanupInput in, SharedSpace space, List<Op> ops) {
    List<String> texts =
        new ArrayList<>(
            new LinkedHashSet<>(
                ops.stream().filter(o -> CONTENT_OPS.contains(o.op())).map(Op::content).toList()));
    Set<String> passed = new HashSet<>();
    for (int from = 0; from < texts.size(); from += CHECK_BATCH) {
      List<String> batch = texts.subList(from, Math.min(texts.size(), from + CHECK_BATCH));
      try {
        CheckResult r =
            client.check(
                new CheckRequest(
                    in.spec().agentUserId(),
                    in.spec().suggestionModel(),
                    timeouts.timeoutMs(AiCall.HOME_SHARED_MEMORY_CHECK_BATCH),
                    space.type().name(),
                    space.label(),
                    batch));
        for (int i = 0; i < batch.size(); i++) {
          if (r.passed(i, batch.size())) passed.add(batch.get(i));
        }
      } catch (MemoryCleanupAiException e) {
        rethrowIfOutage(e);
        log.warn(
            "공용성 검사 실패 — 이 묶음 불통과: space={} 후보={} 원인={}",
            space.param(),
            batch.size(),
            causeName(e));
      }
    }
    return passed;
  }

  /** ai-agent 가 받을 수 없는 상태(읽기 시간 초과 제외)면 다시 던져 세션을 다음 회차로 미룬다 — WP-385 가 장애로 센다. */
  private static void rethrowIfOutage(MemoryCleanupAiException e) {
    if (e.isAgentDown() && !e.isReadTimeout()) throw e;
  }

  /** 로그용 원인 — 메시지에 내용이 섞일 수 있어 클래스 이름만. */
  private static String causeName(MemoryCleanupAiException e) {
    return (e.getCause() != null ? e.getCause() : e).getClass().getSimpleName();
  }
}

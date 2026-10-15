package com.workplace.home.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.outbound.AiAgentSharedMemoryClient;
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

  static final int EXTRACT_TIMEOUT_MS = 30_000;
  static final int CHECK_TIMEOUT_MS = 30_000;

  /** 검사 한 번의 후보 상한(스펙 6.4). */
  static final int CHECK_BATCH = 10;

  /**
   * 공간 하나에서 받아들이는 내용 op(ADD·UPDATE·MERGE) 상한 — 공용성 검사가 10개씩이라 최대 2번. 공간 수 × 30초 검사가 WP-385 회차
   * 예산(25분)과 잠금(40분)을 넘기지 않게 한다. 넘는 op 는 검사·임베딩 전에 버린다(FORGET 은 세지 않는다).
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

  public SharedMemoryExtractionParticipant(
      HomeMessageRepository messages,
      SharedMemorySpaces spaces,
      SharedAiMemoryRepository repo,
      AiAgentSharedMemoryClient client,
      TextEmbedder embedder,
      SharedMemoryOpApplier applier,
      PlatformTransactionManager txManager) {
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

  /** 공간별 준비(트랜잭션 밖) — 할 일이 있는 공간의 계획만 모아, 적용은 같은 트랜잭션 안에서 한다. */
  @Override
  public Prepared prepare(SessionCleanupInput in) {
    Map<SpaceKey, List<String>> bySpace;
    try {
      bySpace = readTx.execute(s -> group(in));
    } catch (RuntimeException e) {
      // 공간 묶기(DB 읽기)가 깨져도 던지지 않는다 — 던지면 WP-385 개인 정리 결과까지 회차 실패로 버려진다. 로그는 예외 클래스 이름만.
      log.warn("공용 메모리 공간 묶기 실패 — 이 세션의 공용 추출 건너뜀: 원인={}", e.getClass().getSimpleName());
      return Prepared.NONE;
    }
    if (bySpace == null || bySpace.isEmpty()) return Prepared.NONE;
    List<SpacePlan> plans = new ArrayList<>();
    for (Map.Entry<SpaceKey, List<String>> e : bySpace.entrySet()) {
      SpacePlan p;
      try {
        p = prepareSpace(in, e.getKey(), e.getValue());
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
    if (plans.isEmpty()) return Prepared.NONE;
    // 공간 잠금을 항상 같은 순서로 잡아 다른 회차와 교착하지 않게 한다.
    plans.sort(Comparator.comparing(p -> p.space().param()));
    long speakerId = in.userId(); // 적용 때 권한 재확인에만 쓴다 — 어디에도 저장하지 않는다.
    return () -> plans.forEach(p -> applyIsolated(speakerId, p));
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

  /** 발화 → 공간별 묶음(발화 순서 유지). 공간 없는 발화와 조직 지침 화면(조직은 관리자가 직접 쓴다)은 빠진다. */
  private Map<SpaceKey, List<String>> group(SessionCleanupInput in) {
    Map<Long, SpaceKey> spaceOf =
        messages.spacesOf(in.utterances().stream().map(Utterance::messageId).toList());
    Map<SpaceKey, List<String>> out = new LinkedHashMap<>();
    for (Utterance u : in.utterances()) {
      SpaceKey k = spaceOf.get(u.messageId());
      if (k == null || "ORG".equals(k.type())) continue;
      out.computeIfAbsent(k, x -> new ArrayList<>()).add(u.text());
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
                      EXTRACT_TIMEOUT_MS,
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
                    CHECK_TIMEOUT_MS,
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

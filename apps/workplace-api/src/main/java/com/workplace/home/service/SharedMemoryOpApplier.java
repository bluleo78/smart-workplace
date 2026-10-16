package com.workplace.home.service;

import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.home.outbound.SharedMemoryMessages.Op;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.repository.SharedAiMemoryRepository.Row;
import com.workplace.home.service.SharedMemoryExtractionParticipant.SpacePlan;
import com.workplace.home.service.SharedSpace.SpaceKey;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 공용 추출 op 적용(WP-386 스펙 6.3) — WP-385 적용 트랜잭션 안(사용자 잠금 뒤)에서 공간 잠금을 잡고 부른다. 모양·근거 번호·문장 길이는 준비 단계가
 * 이미 걸렀고, 여기서는 DB 상태에 달린 것만 본다. 검증에 걸린 op 는 조용히 버리고 예외를 내지 않는다(실패한 SQL 은 트랜잭션 전체를 망가뜨리므로 쓰기 전에 모두
 * 확인한다).
 *
 * <p>규칙: 공간 잠금 아래에서 발화자의 추가 권한을 다시 확인(잃었으면 그 공간은 조용히 건너뜀), 대상은 그 공간의 AI_EXTRACTED·AI_CLEANED 이면서
 * 사람이 고친 적 없는(updated_by 없음) 것만이고 준비 때 본 updated_at 그대로(사람이 그사이 고쳤으면 물러선다), 한 회차에 같은 대상 두 번 금지, 지운
 * 기록과 겹치면 버림, 결과가 다른 항목과 정규화 같음이면 버림 (대상 자신의 지금 문장은 제외), 결과가 지금 행과 그대로인 고침은 건너뜀, ADD 는 한도 안에서만. 결과
 * 출처는 ADD=AI_EXTRACTED, UPDATE·MERGE=AI_CLEANED. 작성자·수정자·행위자는 없고(발화자 추적 금지) 기록은 공간마다 새 run_id 를 쓴다.
 * 서버가 정리로 지운 것은 지운 기록에 넣지 않는다(사람이 지운 것만).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SharedMemoryOpApplier {

  private final SharedMemorySpaces spaces;
  private final SharedAiMemoryRepository repo;
  private final SharedAiMemoryChangeLog changeLog;
  private final SharedAiMemoryForgottenService forgotten;
  private final ApplicationEventPublisher events;

  /** 한 공간의 적용 상태 — 지금 행들과 그 정규화 문장, 이번 회차에 이미 쓴 대상. */
  private record State(
      SpaceKey key,
      UUID runId,
      OffsetDateTime at,
      Map<Long, Row> seen,
      Map<Long, Row> current,
      Map<Long, String> normalizedById,
      Set<Long> used) {}

  /** 한 공간 적용 — 적용한 op 수. 던지지 않는다. */
  public int apply(long speakerId, SpacePlan p) {
    SpaceKey k = p.space().spaceKey();
    repo.lockSpace(k);
    boolean canAdd =
        spaces.access(speakerId, k).map(SharedMemorySpaces.Access::canAdd).orElse(false);
    if (!canAdd) {
      log.debug("공용 메모리 적용 건너뜀(추가 권한 없음): space={}", k.param());
      return 0;
    }
    Map<Long, Row> current = new LinkedHashMap<>();
    for (Row r : repo.all(k)) current.put(r.id(), r);
    Map<Long, String> normalized = new HashMap<>();
    current.forEach((id, r) -> normalized.put(id, MemoryTextNormalizer.normalize(r.content())));
    State st =
        new State(
            k,
            UUID.randomUUID(), // 세션과 무관한 새 묶음 id — 발화자·대화를 되짚을 수 없게 한다.
            OffsetDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MILLIS),
            p.seen().stream().collect(Collectors.toMap(Row::id, Function.identity())),
            current,
            normalized,
            new HashSet<>());
    int applied = 0;
    for (Op op : p.ops()) {
      if (applyOne(st, op, p.vectors().get(op.content()))) applied++;
    }
    log.debug("공용 메모리 추출 적용: space={} op={} 적용={}", k.param(), p.ops().size(), applied);
    return applied;
  }

  /** op 하나 — 적용했으면 true. */
  private boolean applyOne(State st, Op op, float[] vec) {
    List<Row> targets = targets(st, op);
    if (targets == null) return false;
    if (!"FORGET".equals(op.op())) {
      String key = MemoryTextNormalizer.normalize(op.content());
      if (key.isEmpty() || taken(st, key, targets)) return false;
      if (forgotten.isForgotten(st.key(), op.content(), vec)) return false;
    }
    switch (op.op()) {
      case "ADD" -> {
        if (st.current().size() >= SharedAiMemoryRepository.limitOf(st.key())) return false;
        Row r = repo.insert(st.key(), op.content(), "AI_EXTRACTED", null, null, st.at());
        remember(st, r);
        changeLog.record(
            st.key(),
            st.runId(),
            SharedAiMemoryChangeLog.ADDED,
            null,
            r.id(),
            List.of(),
            SharedMemorySnapshot.of(r),
            st.at());
        requestEmbedding(r.id());
      }
      case "UPDATE", "MERGE" -> {
        Row first = targets.get(0);
        boolean merge = "MERGE".equals(op.op());
        // 결과가 지금 행과 그대로인 고침은 바뀌는 것이 없다 — 기록 없이 건너뛴다.
        if (!merge && first.content().equals(op.content())) return false;
        Row saved = repo.update(first.id(), op.content(), "AI_CLEANED", null, st.at());
        for (Row other : targets.subList(1, targets.size())) {
          repo.delete(other.id());
          st.current().remove(other.id());
          st.normalizedById().remove(other.id());
        }
        remember(st, saved);
        changeLog.record(
            st.key(),
            st.runId(),
            merge ? SharedAiMemoryChangeLog.MERGED : SharedAiMemoryChangeLog.UPDATED,
            null,
            saved.id(),
            targets.stream().map(SharedMemorySnapshot::of).toList(),
            SharedMemorySnapshot.of(saved),
            st.at());
        if (!first.content().equals(saved.content())) requestEmbedding(saved.id());
      }
      case "FORGET" -> {
        Row cur = targets.get(0);
        repo.delete(cur.id());
        st.current().remove(cur.id());
        st.normalizedById().remove(cur.id());
        changeLog.record(
            st.key(),
            st.runId(),
            SharedAiMemoryChangeLog.DELETED,
            null,
            cur.id(),
            List.of(SharedMemorySnapshot.of(cur)),
            null,
            st.at());
      }
      default -> {
        return false;
      }
    }
    targets.forEach(t -> st.used().add(t.id()));
    return true;
  }

  /**
   * 대상 검증 — ADD 는 대상 없음(빈 목록), UPDATE·FORGET 1개, MERGE 2개 이상. 각 대상은 준비 때 봤고 지금도 이 공간에 있으며 AI 출처이고
   * 사람이 고친 적이 없으며(updated_by 없음) 준비 때 본 updated_at 그대로이며 이번 회차에 아직 쓰이지 않았어야 한다. 아니면 null(그 op 를
   * 버린다).
   */
  private static List<Row> targets(State st, Op op) {
    List<Long> ids = op.targetIds() == null ? List.of() : op.targetIds();
    List<Long> distinct = ids.stream().distinct().toList();
    int n = distinct.size();
    boolean shapeOk =
        distinct.size() == ids.size()
            && switch (op.op()) {
              case "ADD" -> n == 0;
              case "UPDATE", "FORGET" -> n == 1;
              case "MERGE" -> n >= 2;
              default -> false;
            };
    if (!shapeOk) return null;
    List<Row> out = new ArrayList<>();
    for (Long id : distinct) {
      Row before = st.seen().get(id);
      Row cur = st.current().get(id);
      if (before == null || cur == null || st.used().contains(id)) return null;
      // AI 소유(AI 출처 + updated_by 없음)만 — 사람이 고친 AI 항목(출처는 AI 그대로, updated_by 만 사람)은 사람 항목처럼 지켜 AI 가
      // 고치거나 합치거나
      // 지워 사람의 교정을 되돌리지 못하게 한다(WP-385 가 대화 뒤에 고친 행·고정을 대상에서 빼는 것과 같은 뜻). AI 의 쓰기는 updated_by 를 비운다.
      if (!SharedMemorySpaces.aiOwned(cur.origin(), cur.updatedBy())) return null;
      if (!cur.updatedAt().equals(before.updatedAt())) return null;
      out.add(cur);
    }
    return out;
  }

  /** 같은 정규화 문장이 대상 밖의 다른 항목에 이미 있는가(사람 항목·같은 회차의 앞선 결과 포함). */
  private static boolean taken(State st, String key, List<Row> targets) {
    Set<Long> own = targets.stream().map(Row::id).collect(Collectors.toSet());
    return st.normalizedById().entrySet().stream()
        .anyMatch(e -> !own.contains(e.getKey()) && e.getValue().equals(key));
  }

  /** 저장·고친 행을 지금 상태에 반영한다. */
  private static void remember(State st, Row r) {
    st.current().put(r.id(), r);
    st.normalizedById().put(r.id(), MemoryTextNormalizer.normalize(r.content()));
  }

  /** 내용이 생기거나 바뀐 항목의 임베딩을 커밋 뒤 채우게 한다(롤백되면 사라진다). */
  private void requestEmbedding(long id) {
    events.publishEvent(TextEmbeddingService.Requested.sharedMemory(id));
  }
}

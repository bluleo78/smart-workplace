package com.workplace.home.service;

import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.outbound.MemoryCleanupMessages.Op;
import com.workplace.home.repository.AiMemoryChangeRepository;
import com.workplace.home.repository.AiMemoryChangeRepository.LatestCleanup;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.AiMemoryRepository.Row;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
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
 * 배경 정리 op 검증·적용·기록(WP-385 스펙 5.4·5.5). 호출자(AiMemoryCleanupApplier)의 트랜잭션 안, 사용자 잠금 뒤에 부른다.
 *
 * <p><b>op 하나가 어긋나면 그 op 만 버린다 — 예외를 밖으로 내지 않는다.</b> 검증은 AiMemoryService 의 정적 도우미(프록시를 거치지 않아 던져도
 * 트랜잭션을 rollback-only 로 만들지 않는다)로, 쓰기는 저장소로만 한다: @Transactional 서비스 메서드가 던진 예외를 여기서 잡으면 바깥 트랜잭션이
 * rollback-only 가 돼 이 회차 전체(경계 갱신 포함)를 잃는다. DB 오류도 트랜잭션을 깨므로 한도·대상 존재를 먼저 확인한다.
 *
 * <p>검증: evidence 는 입력 발화 범위 안, 대상은 입력으로 준 메모리이고 지금도 AI 저장·고정 아님·updated_at 이 수집 때와 같아야 한다(동등 비교 —
 * 앱 시계와 DB 시계를 섞지 않는다), 같은 회차에서 이미 쓴 대상은 버린다, 결과 문장이 지운 기록과 겹치면 버린다, 한도면 ADD(또는 다른 범위로 옮기는 고치기)를
 * 버린다. 서버가 정리로 지운 것(FORGET·MERGE 로 사라진 원본)은 지운 기록에 넣지 않는다.
 *
 * <p>최종 리뷰 보강: 사용자가 이 구간 결과 줄에서 되돌린 메모리(보호 id)와 대화가 끝난 뒤 다른 경로(설정·다른 대화)에서 고친 메모리는 대상에서 버린다. 새로
 * 기억하는 문장이 입력 메모리나 같은 회차의 앞선 ADD·고침·합침 결과와 정규화 같음이면 중복이라 버리고(고침·합침 결과도 같은 규칙 — 대상 자신의 지금 문장은 빼고
 * 본다), 결과가 지금 행과 그대로인 고침은 기록 없이 건너뛴다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiMemoryCleanupOpApplier {

  private final AiMemoryRepository repo;
  private final AiMemoryForgottenService forgotten;
  private final AiMemoryChangeLog changeLog;
  private final AiMemoryChangeRepository changeRepo;
  private final AiMemoryClock clock;
  private final ApplicationEventPublisher events;

  /**
   * 한 회차의 공용 상태 — 같은 run_id·시각, 수집 때의 행과 그 정규화 문장, 이미 쓴 대상, 이미 있는 문장(입력 메모리 + 이 회차 결과, 정규화), 대화 뒤에
   * 고친 행의 판정 재료(대화 뒤 되돌린 메모리 id·메모리마다 최신 정리 기록 — 시작 때 한 번에 읽는다).
   */
  private record Run(
      SessionCleanupInput in,
      Map<String, float[]> vectors,
      UUID runId,
      OffsetDateTime at,
      LocalDate today,
      Map<Long, Row> seen,
      Map<Long, String> normalizedById,
      Set<Long> used,
      Set<String> addedKeys,
      Set<Long> undoneAfter,
      Map<Long, LatestCleanup> latestCleanups) {}

  /** ops 를 순서대로 적용하고 적용한 수를 돌려준다(어긋난 op 는 로그만 남기고 건너뛴다). */
  public int applyAll(SessionCleanupInput in, List<Op> ops, Map<String, float[]> vectors) {
    Map<Long, Row> seen =
        in.memories().stream().collect(Collectors.toMap(Row::id, Function.identity(), (a, b) -> a));
    Map<Long, String> normalizedById = new HashMap<>();
    seen.forEach((id, r) -> normalizedById.put(id, MemoryTextNormalizer.normalize(r.content())));
    // 대화 뒤에 고친 행(lockTargets 설명)의 판정 재료 — 대상은 지금도 수집 때와 updated_at 이 같아야 하므로 수집 때 updated_at 이 마지막
    // 메시지보다 늦은 행만 판정에 닿는다. 그 행들만 한 번에 읽는다(사용자 잠금 뒤라 대상별로 읽던 것과 같은 값 — 되돌리기도 같은 잠금을 잡는다).
    List<Long> editedLate =
        in.lastMessageAt() == null
            ? List.of()
            : in.memories().stream()
                .filter(r -> r.updatedAt().isAfter(in.lastMessageAt()))
                .map(Row::id)
                .toList();
    Run run =
        new Run(
            in,
            vectors,
            UUID.randomUUID(),
            OffsetDateTime.now(ZoneOffset.UTC),
            clock.today(),
            seen,
            normalizedById,
            new HashSet<>(),
            // 입력 메모리 문장 — 같은 문장을 새로 기억하면 중복이다(모델이 UPDATE 대신 ADD 를 낸 경우).
            new HashSet<>(normalizedById.values()),
            editedLate.isEmpty()
                ? Set.of()
                : changeRepo.undoneAfter(in.userId(), editedLate, in.lastMessageAt()),
            editedLate.isEmpty()
                ? Map.of()
                : changeRepo.latestCleanups(in.userId(), editedLate).stream()
                    .collect(Collectors.toMap(LatestCleanup::memoryId, Function.identity())));
    int applied = 0;
    for (Op op : ops) {
      try {
        if (applyOne(run, op)) applied++;
        else log.debug("정리 op 버림: session={} op={}", in.sessionId(), op.op());
      } catch (AiMemoryException e) {
        log.debug("정리 op 버림(검증): session={} op={} {}", in.sessionId(), op.op(), e.getMessage());
      }
    }
    if (!ops.isEmpty()) {
      // 내용·사용자 id 는 남기지 않는다 — 세션·건수만.
      log.info("메모리 정리 적용 — session={} 받음 {} 적용 {}", in.sessionId(), ops.size(), applied);
    }
    return applied;
  }

  /**
   * op 하나 — 적용했으면 true. 검증 실패는 false 또는 AiMemoryException(정적 도우미). null·이름 없는 op 은 Result 가 이미 걸렀다.
   */
  private boolean applyOne(Run run, Op op) {
    Integer ev = op.evidence();
    if (ev == null || ev < 0 || ev >= run.in().utterances().size()) return false;
    return switch (op.op()) {
      case "ADD" -> add(run, op);
      case "UPDATE" -> rewrite(run, op, 1, 1, AiMemoryChangeAction.UPDATED);
      case "MERGE" -> rewrite(run, op, 2, Integer.MAX_VALUE, AiMemoryChangeAction.MERGED);
      case "FORGET" -> forget(run, op);
      default -> false;
    };
  }

  /** 새로 기억함 — 대상 없음, 종류 필수, 지운 기록·이미 있는 문장(입력 메모리·같은 회차 결과)·한도 확인. */
  private boolean add(Run run, Op op) {
    if (op.targetIds() != null && !op.targetIds().isEmpty()) return false;
    long uid = run.in().userId();
    String content = AiMemoryService.normalizeContent(op.content());
    String kind = AiMemoryService.requireKind(op.kind());
    String scope = AiMemoryService.requireScope(op.scope());
    LocalDate exp = AiMemoryService.parseExpiresOn(op.expiresOn(), run.today());
    String key = MemoryTextNormalizer.normalize(content);
    if (key.isEmpty() || !run.addedKeys().add(key)) return false;
    if (forgotten.isForgotten(uid, content, run.vectors().get(op.resultText()))) return false;
    if (AiMemoryService.overLimit(repo, uid, scope, exp, run.today())) return false;
    Row saved =
        repo.insert(
            uid,
            new NewMemory(
                kind, content, AiMemoryService.SOURCE_AI, run.in().sessionId(), scope, exp));
    requestEmbedding(saved.id());
    changeLog.record(
        uid,
        run.runId(),
        AiMemoryChangeAction.ADDED,
        saved.id(),
        List.of(),
        MemorySnapshot.of(saved),
        run.in().sessionId(),
        op.reason(),
        run.at());
    return true;
  }

  /** 고침(대상 1) · 합침(대상 2 이상, 첫 대상을 남기고 나머지는 지운다 — 결과 id 가 안정적이다). */
  private boolean rewrite(Run run, Op op, int min, int max, AiMemoryChangeAction action) {
    List<Row> targets = lockTargets(run, op.targetIds(), min, max);
    if (targets == null) return false;
    long uid = run.in().userId();
    Row first = targets.get(0);
    String content = AiMemoryService.normalizeContent(op.content());
    String kind = AiMemoryService.requireKind(op.kind() == null ? first.kind() : op.kind());
    String scope = AiMemoryService.requireScope(op.scope());
    LocalDate exp = AiMemoryService.parseExpiresOn(op.expiresOn(), run.today());
    // 결과가 지금 행과 그대로인 고침은 바뀌는 것이 없다 — 기록·출처·시각을 건드리지 않고 건너뛴다(되돌리기와 같은 술어).
    if (action == AiMemoryChangeAction.UPDATED
        && MemorySnapshot.sameContent(first, content, kind, scope, exp)) {
      return false;
    }
    // 결과 문장이 다른 메모리(입력 메모리·같은 회차의 앞선 결과)와 정규화 같음이면 중복이다 — ADD 와 같은 규칙. 대상 자신의 지금 문장은 빼고 본다(범위만
    // 옮기는 고침, 대상 하나의 문장으로 합치는 합침은 중복이 아니다).
    String key = MemoryTextNormalizer.normalize(content);
    boolean ownSentence =
        targets.stream().anyMatch(t -> key.equals(run.normalizedById().get(t.id())));
    if (!ownSentence && run.addedKeys().contains(key)) return false;
    if (forgotten.isForgotten(uid, content, run.vectors().get(op.resultText()))) return false;
    // 그 범위에서 새로 유효해지면(범위 이동·만료 행 되살림) 그 범위 한도를 센다 — AiMemoryService.update 와 같은 판정.
    if (AiMemoryService.activatesInto(first, scope, exp, run.today())
        && AiMemoryService.overLimit(repo, uid, scope, exp, run.today())) {
      return false;
    }
    Row saved =
        repo.applyCleanup(
                uid, first.id(), kind, content, scope, exp, run.in().sessionId(), run.at())
            .orElse(null);
    if (saved == null) return false;
    repo.deleteByIds(uid, targets.subList(1, targets.size()).stream().map(Row::id).toList());
    if (!first.content().equals(saved.content())) requestEmbedding(saved.id());
    targets.forEach(t -> run.used().add(t.id()));
    run.addedKeys().add(key);
    changeLog.record(
        uid,
        run.runId(),
        action,
        first.id(),
        targets.stream().map(MemorySnapshot::of).toList(),
        MemorySnapshot.of(saved),
        run.in().sessionId(),
        op.reason(),
        run.at());
    return true;
  }

  /** 대화와 맞지 않아 지움(대상 1) — 지운 기록에는 넣지 않는다. */
  private boolean forget(Run run, Op op) {
    List<Row> targets = lockTargets(run, op.targetIds(), 1, 1);
    if (targets == null) return false;
    long uid = run.in().userId();
    Row cur = targets.get(0);
    repo.delete(uid, cur.id());
    run.used().add(cur.id());
    changeLog.record(
        uid,
        run.runId(),
        AiMemoryChangeAction.FORGOTTEN,
        cur.id(),
        List.of(MemorySnapshot.of(cur)),
        null,
        run.in().sessionId(),
        op.reason(),
        run.at());
    return true;
  }

  /**
   * 대상 행을 잠그고 돌려준다 — 개수가 [min, max] 이고 중복 없이, 모두 입력으로 준 메모리이며 이 회차에서 아직 안 썼고, 보호 id(결과 줄에서 되돌림)가
   * 아니고, 지금도 AI 저장·고정 아님·updated_at 이 수집 때와 같고, 대화가 끝난 뒤 다른 경로에서 고친 것이 아닐 때만. 하나라도 어긋나면 null(그 op 를
   * 버린다).
   *
   * <p>「대화 뒤에 고침」: updated_at 이 구간 마지막 메시지 시각보다 늦으면 대화가 끝난 뒤 누군가 고친 것이다 — 그 고침이 이 대화의 앞선 정리 회차 결과(이
   * 대화가 남긴 최신 정리 기록의 after 가 지금 행과 그대로)일 때만 대상으로 남기고, 그 밖(설정에서 고침·다른 대화의 update_memory·다른 대화의 정리·
   * 기록 화면 되돌리기)은 이 대화가 근거가 될 수 없어 버린다. 출처 대화만으로는 가를 수 없다 — 설정 고치기는 출처를 바꾸지 않아 이 대화가 저장한 메모리를 사용자가
   * 고쳐도 출처가 이 대화로 남는다.
   *
   * <p>시계: 고친 행의 updated_at 과 undone_at 은 앱 시계(새로 저장한 행의 updated_at 은 DB 기본값), 메시지 시각은 DB 시계라 섞인다.
   * 앱 시계가 DB 시계보다 <b>빠르면</b> 대화 중(마지막 메시지 전)의 고침이 대화 뒤로 보여 op 를 버린다(안전한 쪽). 앱 시계가 <b>늦으면</b> 마지막
   * 메시지 직후(시계 차이 안)의 고침이 대화 전으로 보여 이 판정을 지나고, 수집 뒤에 다시 바뀐 것이 아니면 그 고침을 덮을 수 있다(updated_at 동등 비교는 수집
   * 뒤의 고침만 막는다). 시계 차이가 보통 1초 미만이라 그 틈은 작다.
   */
  private List<Row> lockTargets(Run run, List<Long> ids, int min, int max) {
    if (ids == null) return null;
    List<Long> distinct = ids.stream().distinct().toList();
    if (distinct.size() != ids.size() || distinct.size() < min || distinct.size() > max)
      return null;
    List<Row> out = new ArrayList<>();
    for (long id : distinct) {
      Row seen = run.seen().get(id);
      if (seen == null || run.used().contains(id) || run.in().protectedIds().contains(id)) {
        return null;
      }
      Row cur = repo.lock(run.in().userId(), id).orElse(null);
      if (cur == null
          || !AiMemoryService.SOURCE_AI.equals(cur.source())
          || cur.pinned()
          || !cur.updatedAt().equals(seen.updatedAt())
          || editedAfterConversation(run, cur)) {
        return null;
      }
      out.add(cur);
    }
    return out;
  }

  /**
   * 구간 마지막 메시지 뒤에 이 대화의 정리가 아닌 경로에서 고친 행인가(위 lockTargets 설명). 마지막 메시지 시각을 모르면 판정하지 않는다. 기록은 회차 시작 때
   * 대화 뒤에 바뀐 행만 한 번에 읽어 두었다(applyAll).
   *
   * <p>대화 뒤에 그 메모리의 정리 기록을 하나라도 되돌렸으면(undone_at > 마지막 메시지) 사용자가 바꾼 것이다 — 같은 대화의 ADDED → UPDATED 중
   * UPDATED 만 되돌리면 지금 행이 앞선 ADDED 결과와 그대로라 아래 최신 기록 비교만으로는 이 대화 자신의 결과로 보이기 때문이다.
   */
  private boolean editedAfterConversation(Run run, Row cur) {
    SessionCleanupInput in = run.in();
    if (in.lastMessageAt() == null || !cur.updatedAt().isAfter(in.lastMessageAt())) return false;
    if (run.undoneAfter().contains(cur.id())) return true;
    LatestCleanup c = run.latestCleanups().get(cur.id());
    if (c == null || !in.sessionId().equals(c.sourceSessionId())) return true;
    MemorySnapshot after = changeLog.readAfter(c.afterJson());
    return after == null || !after.sameAs(cur);
  }

  /** 내용이 생기거나 바뀐 메모리의 임베딩을 커밋 뒤 채우게 한다(롤백되면 사라진다). */
  private void requestEmbedding(long memoryId) {
    events.publishEvent(TextEmbeddingService.Requested.memory(memoryId));
  }
}

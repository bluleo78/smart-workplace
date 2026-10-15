package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.home.outbound.MemoryCleanupMessages;
import com.workplace.home.repository.AiMemoryCleanupRepository;
import com.workplace.home.repository.AiMemoryCleanupRepository.Message;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.SessionCleanupInput.AssistantNote;
import com.workplace.home.service.SessionCleanupInput.Utterance;
import com.workplace.user.service.AiPreferenceService;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.function.ToIntFunction;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 배경 정리 1단 — 입력 수집(WP-385 스펙 5.1·5.2). 짧은 읽기 트랜잭션으로 경계 뒤 메시지·꺼짐·이 대화가 저장한 메모리를 읽고, 건너뛸 세션(꺼짐·비서
 * 없음·사용자 발화 20자 미만)을 가른 뒤, 트랜잭션 밖에서 비교 대상 메모리를 고른다(질의 임베딩 대기를 DB 연결을 쥔 채 하지 않게). 호출자가 TenantContext
 * 를 세운다.
 */
@Component
public class AiMemoryCleanupCollector {

  static final int UTTERANCE_MAX = 4_000;
  static final int UTTERANCES_TOTAL_MAX = 16_000;
  static final int NOTE_MAX = 300;

  /**
   * AI 답 합계 상한(코드포인트)·개수 상한 — 넘으면 오래된 것부터 버린다. ai-agent zod 상한(MemoryCleanupMessages.LIST_MAX)에 걸리면
   * 400 이 세 번 나 그 대화 정리를 잃고, 답은 참고일 뿐이라 최근 것으로 충분하다.
   */
  static final int NOTES_TOTAL_MAX = 6_000;

  static final int NOTES_COUNT_MAX = 60;

  /** 사용자 발화 개수 상한 — ai-agent zod 상한과 같다. 짧은 발화가 아주 많으면 합계 상한(16,000자)만으로는 막지 못한다. */
  static final int UTTERANCES_COUNT_MAX = MemoryCleanupMessages.LIST_MAX;

  static final int MIN_USER_CHARS = 20;
  static final int TOUCHED_MAX = 10;
  static final int RELATED_MAX = 20;
  static final int MEMORIES_MAX = 30;
  static final int QUERY_MAX = 2_000;
  static final Duration RELATED_EMBED_WAIT = Duration.ofSeconds(5);

  /** 수집 결과. */
  public sealed interface Collected permits Nothing, Skip, Ready {}

  /** 경계 뒤 메시지가 없다(대상 선정과 수집 사이에 다른 회차가 처리) — 아무것도 하지 않는다. */
  public record Nothing() implements Collected {}

  /** 정리하지 않고 경계만 올린다. */
  public record Skip(long uptoId, String reason) implements Collected {}

  /** 정리할 입력. */
  public record Ready(SessionCleanupInput input) implements Collected {}

  /**
   * 첫 읽기 결과 — 정리할 세션이면(켜짐·사용자 발화 20자 이상) 보호 id(결과 줄에서 되돌림)와 이 대화가 저장·수정한 비교 대상 행까지 같은 트랜잭션에서 읽는다.
   */
  private record Raw(
      List<Message> messages, boolean enabled, Set<Long> protectedIds, List<Row> touched) {}

  /** 답의 memory 블록 하나 — id·동작(saved·updated·forgotten)·되돌림 여부. */
  record MemoryBlock(long memoryId, String action, boolean undone) {}

  private final AiMemoryCleanupRepository cleanupRepo;
  private final AiMemoryRepository memoryRepo;
  private final AiPreferenceService preferences;
  private final AssistantResolver assistantResolver;
  private final AiMemorySelector selector;
  private final AiMemoryClock clock;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate tx;

  public AiMemoryCleanupCollector(
      AiMemoryCleanupRepository cleanupRepo,
      AiMemoryRepository memoryRepo,
      AiPreferenceService preferences,
      AssistantResolver assistantResolver,
      AiMemorySelector selector,
      AiMemoryClock clock,
      ObjectMapper objectMapper,
      PlatformTransactionManager txManager) {
    this.cleanupRepo = cleanupRepo;
    this.memoryRepo = memoryRepo;
    this.preferences = preferences;
    this.assistantResolver = assistantResolver;
    this.selector = selector;
    this.clock = clock;
    this.objectMapper = objectMapper;
    this.tx = new TransactionTemplate(txManager);
    this.tx.setReadOnly(true);
  }

  /** 한 세션 수집. */
  public Collected collect(long tenantId, long userId, UUID sessionId, Long processedId) {
    LocalDate today = clock.today();
    Raw raw =
        tx.execute(
            s -> {
              List<Message> msgs = cleanupRepo.newMessages(sessionId, processedId);
              if (msgs.isEmpty()) return null;
              boolean enabled = preferences.memoryEnabled(userId);
              // 건너뛸 세션(꺼짐·짧은 대화)이면 비교 대상을 읽지 않는다.
              if (!enabled || userChars(msgs) < MIN_USER_CHARS) {
                return new Raw(msgs, enabled, Set.of(), List.of());
              }
              List<MemoryBlock> blocks = memoryBlocks(msgs, objectMapper);
              // 사용자가 이 구간 결과 줄에서 되돌린 메모리 — 정리가 다시 고치거나 지우지 않게 보호하고, 비교 대상에도 실어 「바꾸지 말 것」으로 보인다.
              Set<Long> protectedIds = new LinkedHashSet<>(undoneMemoryIds(blocks));
              // 이 대화에서 저장·수정된 메모리(답의 memory 블록 + 보호 + 출처가 이 대화) — 최대 10.
              Set<Long> touchedIds = new LinkedHashSet<>(blockMemoryIds(blocks));
              touchedIds.addAll(protectedIds);
              touchedIds.addAll(cleanupRepo.memoryIdsFromSession(userId, sessionId));
              List<Long> touchedTop = touchedIds.stream().limit(TOUCHED_MAX).toList();
              return new Raw(
                  msgs, true, protectedIds, memoryRepo.findActiveByIds(userId, touchedTop, today));
            });
    if (raw == null) return new Nothing();
    Message last = raw.messages().get(raw.messages().size() - 1);
    long upto = last.id();
    if (!raw.enabled()) return new Skip(upto, "메모리 꺼짐");
    AssistantSpec spec = assistantResolver.resolveOrEmpty(userId).orElse(null);
    if (spec == null) return new Skip(upto, "비서 없음");
    if (userChars(raw.messages()) < MIN_USER_CHARS) return new Skip(upto, "짧은 대화");

    List<Utterance> utterances = utterances(raw.messages());
    List<AssistantNote> notes = notes(raw.messages(), utterances);
    // 사용자 발화를 질의로 RRF 상위 20(공통 + 모든 앱) — 트랜잭션 밖에서 질의 임베딩을 기다린다. 사용 기록은 남기지 않는다.
    List<Row> related =
        selector.related(userId, queryText(utterances), today, RELATED_EMBED_WAIT, RELATED_MAX);
    Map<Long, Row> merged = new LinkedHashMap<>();
    for (Row r : raw.touched()) merged.putIfAbsent(r.id(), r);
    for (Row r : related) merged.putIfAbsent(r.id(), r);
    List<Row> memories = merged.values().stream().limit(MEMORIES_MAX).toList();
    return new Ready(
        new SessionCleanupInput(
            tenantId,
            userId,
            sessionId,
            processedId,
            upto,
            utterances,
            notes,
            memories,
            spec,
            today,
            last.createdAt(),
            raw.protectedIds()));
  }

  /** 새 사용자 메시지 글자 합(앞뒤 공백 제거, 코드포인트) — 20자 미만이면 건너뛴다. */
  static int userChars(List<Message> msgs) {
    int n = 0;
    for (Message m : msgs) {
      if (!"USER".equals(m.role()) || m.content() == null) continue;
      String t = m.content().strip();
      n += t.codePointCount(0, t.length());
    }
    return n;
  }

  /** 사용자 발화 — 빈 것 빼고 각 4,000자, 합계 16,000자·개수 500개를 넘으면 오래된 것부터 버린다. */
  static List<Utterance> utterances(List<Message> msgs) {
    List<Utterance> all = new ArrayList<>();
    for (Message m : msgs) {
      if (!"USER".equals(m.role()) || m.content() == null) continue;
      String t = m.content().strip();
      if (!t.isEmpty())
        all.add(new Utterance(m.id(), MemoryTextNormalizer.headCodePoints(t, UTTERANCE_MAX)));
    }
    return keepNewestWithinCaps(
        all, u -> codePoints(u.text()), UTTERANCES_TOTAL_MAX, UTTERANCES_COUNT_MAX);
  }

  /**
   * AI 답 — 첫 발화 뒤의 비지 않은 답을 300자로, after 는 바로 앞 발화 인덱스(도구 결과·위젯·첨부는 본문에 없어 실리지 않는다). 합계 6,000자·60개를
   * 넘으면 오래된 것부터 버린다.
   */
  static List<AssistantNote> notes(List<Message> msgs, List<Utterance> utterances) {
    List<AssistantNote> out = new ArrayList<>();
    int idx = -1;
    int u = 0;
    for (Message m : msgs) {
      while (u < utterances.size() && utterances.get(u).messageId() <= m.id()) idx = u++;
      if (!"ASSISTANT".equals(m.role()) || idx < 0 || m.content() == null) continue;
      String t = m.content().strip();
      if (!t.isEmpty())
        out.add(new AssistantNote(idx, MemoryTextNormalizer.headCodePoints(t, NOTE_MAX)));
    }
    return keepNewestWithinCaps(out, n -> codePoints(n.text()), NOTES_TOTAL_MAX, NOTES_COUNT_MAX);
  }

  /**
   * 최근 것(뒤쪽)부터 합계(chars 합 ≤ totalMax)·개수(≤ countMax) 상한 안에서 남긴다 — 넘는 지점 앞(오래된 쪽)을 버린다. 순서는 그대로다.
   * 발화·AI 답이 같은 규칙을 쓴다.
   */
  static <T> List<T> keepNewestWithinCaps(
      List<T> items, ToIntFunction<T> chars, int totalMax, int countMax) {
    int total = 0;
    int from = items.size();
    for (int i = items.size() - 1; i >= 0; i--) {
      int n = chars.applyAsInt(items.get(i));
      if (total + n > totalMax || items.size() - i > countMax) break;
      total += n;
      from = i;
    }
    return List.copyOf(items.subList(from, items.size()));
  }

  private static int codePoints(String s) {
    return s.codePointCount(0, s.length());
  }

  /** 답의 memory 블록 중 saved·updated 이고 되돌리지 않은 memoryId(나온 순서, 중복 없이). */
  static List<Long> blockMemoryIds(List<MemoryBlock> blocks) {
    return distinctIds(
        blocks, b -> ("saved".equals(b.action()) || "updated".equals(b.action())) && !b.undone());
  }

  /** 답의 memory 블록 중 사용자가 되돌린(undone) memoryId — 동작(saved·updated·forgotten) 무관, 나온 순서, 중복 없이. */
  static List<Long> undoneMemoryIds(List<MemoryBlock> blocks) {
    return distinctIds(blocks, MemoryBlock::undone);
  }

  private static List<Long> distinctIds(List<MemoryBlock> blocks, Predicate<MemoryBlock> accept) {
    Set<Long> ids = new LinkedHashSet<>();
    for (MemoryBlock b : blocks) if (accept.test(b)) ids.add(b.memoryId());
    return List.copyOf(ids);
  }

  /**
   * 답의 개인 memory 블록(id 가 숫자인 것, 나온 순서)을 한 번 읽는다. 깨진 JSON 인 메시지는 건너뛴다. 개인
   * action(saved·updated·forgotten, {@link ChatBlockRecorder.Memory#ACTIONS}) 허용 목록만 읽는다 — 공용 메모리
   * 결과 줄(action "shared", WP-386)의 memoryId 는 공용 메모리 표의 id 라 개인 메모리 id 와 겹칠 수 있어, 읽으면 무관한 개인 메모리를
   * 보호·수정 대상으로 잘못 잡는다(새 action 이 생겨도 기본은 제외).
   */
  static List<MemoryBlock> memoryBlocks(List<Message> msgs, ObjectMapper om) {
    List<MemoryBlock> out = new ArrayList<>();
    for (Message m : msgs) {
      if (!"ASSISTANT".equals(m.role()) || m.contentBlocksJson() == null) continue;
      try {
        for (JsonNode b : om.readTree(m.contentBlocksJson())) {
          if ("memory".equals(b.path("kind").asText())
              && ChatBlockRecorder.Memory.ACTIONS.contains(b.path("action").asText())
              && b.path("memoryId").canConvertToLong()) {
            out.add(
                new MemoryBlock(
                    b.path("memoryId").asLong(),
                    b.path("action").asText(),
                    b.path("undone").asBoolean(false)));
          }
        }
      } catch (Exception e) {
        // 손상된 블록은 비교 대상에서만 빠진다 — 정리 자체는 계속한다.
      }
    }
    return out;
  }

  /** 비교 대상 질의 — 발화를 줄바꿈으로 이어 앞 2,000자. */
  static String queryText(List<Utterance> utterances) {
    return MemoryTextNormalizer.headCodePoints(
        utterances.stream().map(Utterance::text).collect(Collectors.joining("\n")), QUERY_MAX);
  }
}

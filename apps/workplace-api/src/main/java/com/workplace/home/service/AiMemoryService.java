package com.workplace.home.service;

import com.workplace.global.util.TokenEstimates;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.AiMemoryListResponse;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.outbound.ChatMessages.ChatMemory;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.repository.HomeSessionRepository;
import com.workplace.user.service.AiPreferenceService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 메모리(WP-55) — 사용자가 대화에서 알려 준 교정·선호(PREFERENCE)와 업무 맥락(CONTEXT). 설정 화면 직접 관리와 AI 대행 도구가 같은
 * 규칙(1~300자 코드포인트, 범위마다 50개, 본인 것만)을 쓴다.
 *
 * <p>서버가 강제하는 것은 길이·상한·소유자·꺼짐까지다 — "사용자 본인 발화에서만 저장"은 ai-agent 시스템 프롬프트 규칙이다.
 */
@Service
@RequiredArgsConstructor
public class AiMemoryService {

  /** 범위(공통 또는 앱 하나)마다 상한 — WP-379. 응답 limit 도 이 값("범위마다")이다. 매 턴 공통 + 지금 앱 최대 100개를 주입한다. */
  static final int LIMIT = 50;

  /** 설정 목록 최대 행 — 범위 7개 × 50 + 만료 행 여유(판정 3). 목록이 이보다 길면 오래된 것부터 빠진다. */
  static final int LIST_CAP = 500;

  /** 내용 최대 길이(코드포인트). DB VARCHAR(300) 과 같다. */
  static final int MAX_CHARS = 300;

  /** 종류: 사용자가 알려 준 선호·교정(블록 라벨 "선호"). */
  static final String KIND_PREFERENCE = "PREFERENCE";

  /** 종류: 오래 유지될 업무 맥락 — 팀·역할·주로 보는 프로젝트(블록 라벨 "맥락"). */
  static final String KIND_CONTEXT = "CONTEXT";

  /** 출처: AI 가 대화 중 대행으로 저장(Internal on-behalf-of 경로만 이 값을 받는다). */
  static final String SOURCE_AI = "AI";

  /** 출처: 사용자가 설정 화면에서 직접 추가 — 브라우저·PAT·API 키 요청은 항상 이 값으로 저장한다. */
  static final String SOURCE_USER = "USER";

  /** 허용 종류 — 영속 블록 검증(ChatBlockRecorder.Memory)도 같은 집합을 쓴다. */
  static final Set<String> KINDS = Set.of(KIND_PREFERENCE, KIND_CONTEXT);

  private final AiMemoryRepository repo;
  private final AiPreferenceService preferences;
  private final HomeSessionRepository sessionRepo;

  /** 본인 메모리 목록(범위 무관 최신순, 최대 LIST_CAP) + 범위마다 상한 — 웹이 범위별로 묶는다. */
  @Transactional(readOnly = true)
  public AiMemoryListResponse list(long userId) {
    return new AiMemoryListResponse(
        repo.listNewest(userId, LIST_CAP).stream().map(AiMemoryService::toItem).toList(), LIMIT);
  }

  /**
   * 생성 — internal(ai-agent 대행)일 때만 source:'AI' 와 세션을 받는다. 세션은 호출자 소유일 때만 기록한다(남의 세션 id 를 실어도 null).
   * WP-379: scope(null = 공통)를 검증하고 그 범위의 상한을 센다.
   *
   * @throws AiMemoryException 409 DISABLED(대행 + 꺼짐), 409 FULL(+scope), 400
   */
  @Transactional
  public AiMemoryItem create(long userId, CreateAiMemoryRequest req, boolean internal) {
    if (internal) requireEnabled(userId);
    boolean ai = internal && SOURCE_AI.equals(req.source());
    UUID session = ai ? ownedSession(userId, req.sessionId()) : null;
    String scope = requireScope(req.scope());
    return toItem(
        insertChecked(
            userId, req.kind(), req.content(), ai ? SOURCE_AI : SOURCE_USER, session, null, scope));
  }

  /**
   * 고치기 — 생략한 필드는 그대로(scope 는 present-flag, null = 공통). 대행이면 꺼짐 409. 응답에 이전 내용·종류·범위를
   * 싣는다(update_memory 결과·채팅 되돌리기 근거). 다른 범위로 옮길 때만 대상 범위 상한을 센다(판정 5 — 같은 범위 안 고치기는 가득 찬 범위에서도 된다).
   *
   * @throws AiMemoryException 400(바꿀 값 없음·검증 실패), 404(없음·남의 것), 409(대행 + 꺼짐, 대상 범위 가득)
   */
  @Transactional
  public AiMemoryItem update(long userId, long id, UpdateAiMemoryRequest req, boolean internal) {
    if (internal) requireEnabled(userId);
    if (req == null || !req.hasChanges()) throw AiMemoryException.invalid("바꿀 내용이 없어요");
    String targetScope = req.hasScope() ? requireScope(req.scope()) : null;
    // 범위를 옮기면 대상 범위 개수를 센다 — 행 잠금보다 사용자 잠금을 먼저 잡는다(생성·되돌리기와 같은 순서라 교착이 없다).
    if (req.hasScope()) repo.lockUser(userId);
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::notFound);
    String c = req.content() == null ? cur.content() : normalizeContent(req.content());
    String k = req.kind() == null ? cur.kind() : requireKind(req.kind());
    String s = req.hasScope() ? targetScope : cur.scope();
    requireRoomIfEntering(userId, cur, s);
    Row saved = repo.update(userId, id, k, c, s).orElseThrow(AiMemoryException::notFound);
    return toItem(saved, cur);
  }

  /** 내용·종류만 고치는 호출(기존 호출부·테스트 호환) — 범위는 그대로. */
  @Transactional
  public AiMemoryItem update(long userId, long id, String content, String kind, boolean internal) {
    return update(userId, id, new UpdateAiMemoryRequest(content, kind), internal);
  }

  /** 지우기 — 대행이면 꺼짐 409. 지운 항목을 돌려준다(forget_memory 결과·설정 "되돌리기" 토스트 근거 — 범위 포함). */
  @Transactional
  public AiMemoryItem delete(long userId, long id, boolean internal) {
    if (internal) requireEnabled(userId);
    return toItem(repo.delete(userId, id).orElseThrow(AiMemoryException::notFound));
  }

  /**
   * 되돌리기용 재생성(WP-55 §6 forgotten) — 꺼짐과 무관(사용자가 직접 하는 정리), 같은 source·범위(WP-379), 그 범위 상한만 검사. <b>원래
   * id 로</b> 다시 만든다 — 새 id 면 같은 메모리를 가리키던 앞선 결과 줄(saved·updated)의 되돌리기가 엉뚱하게 "이미 없음"으로 끝나고 되살린 메모리는
   * 남는다. 이미 쓰였으면(같은 메모리를 다른 줄로 이미 되살림 등) 새 id 로 만든다.
   *
   * @param scope 블록의 범위(null = 공통 — 구 블록 포함)
   */
  @Transactional
  public AiMemoryItem restore(
      long userId, long memoryId, String kind, String content, String source, String scope) {
    String s = SOURCE_AI.equals(source) ? SOURCE_AI : SOURCE_USER;
    return toItem(insertChecked(userId, kind, content, s, null, memoryId, requireScope(scope)));
  }

  /** 되돌리기용 삭제(saved) — 이미 없으면 false(그대로 진행). */
  @Transactional
  public boolean deleteIfExists(long userId, long id) {
    return repo.delete(userId, id).isPresent();
  }

  /**
   * 되돌리기 비교·복원의 한쪽 값 — 결과 줄의 고친 뒤(after) 또는 고치기 전(before). kind 가 null 이면 "모름", scope 가 null 이면 공통.
   */
  public record Snapshot(String content, String kind, String scope) {}

  /**
   * 되돌리기용 고침 복원(updated). 이미 없으면 404 AI_MEMORY_GONE. 그 고침 뒤에 다시 바뀌었으면 409 AI_MEMORY_CHANGED — 지금 내용
   * ≠ 고친 내용, 이전 종류가 기록된 줄이면 지금 종류 ≠ 고친 종류, 지금 범위 ≠ 고친 범위(판정 6 — 구 블록은 공통). 이전 종류가 있으면 종류도, 범위는 항상
   * 이전 범위로 돌려놓는다. 다른 범위로 돌아가는데 그 범위가 가득이면 409 FULL.
   */
  @Transactional
  public AiMemoryItem restoreContent(long userId, long id, Snapshot after, Snapshot before) {
    // 범위 이동이 생길 수 있어 사용자 잠금을 먼저 잡는다(update·insertChecked 와 같은 순서).
    repo.lockUser(userId);
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::gone);
    boolean kindChanged = before.kind() != null && !cur.kind().equals(after.kind());
    if (!cur.content().equals(after.content())
        || kindChanged
        || !Objects.equals(cur.scope(), after.scope())) {
      throw AiMemoryException.changed();
    }
    String k = before.kind() == null ? cur.kind() : requireKind(before.kind());
    String s = requireScope(before.scope());
    requireRoomIfEntering(userId, cur, s);
    Row saved =
        repo.update(userId, id, k, normalizeContent(before.content()), s)
            .orElseThrow(AiMemoryException::gone);
    return toItem(saved, cur);
  }

  /** 모두 지우기 — 본인 것만(모든 범위). */
  @Transactional
  public void clear(long userId) {
    repo.deleteAll(userId);
  }

  /** 대행 쓰기 전 꺼짐 확인 — 꺼져 있으면 409 AI_MEMORY_DISABLED. */
  private void requireEnabled(long userId) {
    if (!preferences.memoryEnabled(userId)) throw AiMemoryException.disabled();
  }

  /** 호출자 소유 대화 세션이면 그 id, 아니면 null — 남의 세션을 출처로 남기지 않는다. */
  private UUID ownedSession(long userId, UUID sessionId) {
    if (sessionId == null) return null;
    return sessionRepo
        .findById(sessionId)
        .filter(r -> r.userId() == userId)
        .map(r -> sessionId)
        .orElse(null);
  }

  /** 다른 범위로 들어갈 때만 대상 범위 개수를 센다(판정 5). 같은 범위 안 고치기는 가득 찬 범위에서도 된다. 호출자가 사용자 잠금을 이미 잡았다. */
  private void requireRoomIfEntering(long userId, Row cur, String targetScope) {
    if (Objects.equals(cur.scope(), targetScope)) return;
    if (repo.countInScope(userId, targetScope) >= LIMIT) throw AiMemoryException.full(targetScope);
  }

  /**
   * 검증 → 사용자 잠금 → 그 범위 상한 확인 → 저장(preferredId 가 있으면 그 id 를 먼저 시도). 잠금을 먼저 잡아야 동시 요청 두 건이 모두 49개를 보고
   * 51개가 되는 일을 막는다(READ COMMITTED 에서 잠금 뒤 count 는 앞 요청의 커밋을 본다).
   */
  Row insertChecked(
      long userId,
      String kind,
      String content,
      String source,
      UUID sessionId,
      Long preferredId,
      String scope) {
    String k = requireKind(kind);
    String c = normalizeContent(content);
    repo.lockUser(userId);
    if (repo.countInScope(userId, scope) >= LIMIT) throw AiMemoryException.full(scope);
    // 되살리기(preferredId)는 원래 id 를 먼저 시도하고, 쓸 수 없으면 새 id 로 만든다.
    if (preferredId != null) {
      Optional<Row> same = repo.insertWithId(preferredId, userId, k, c, source, sessionId, scope);
      if (same.isPresent()) return same.get();
    }
    return repo.insert(userId, k, c, source, sessionId, scope);
  }

  /** 앞뒤 공백 제거 후 1~300 코드포인트인지 — 넘으면 자르지 않고 400(뜻이 바뀌므로). */
  static String normalizeContent(String raw) {
    String c = raw == null ? "" : raw.strip();
    int n = c.codePointCount(0, c.length());
    if (n == 0 || n > MAX_CHARS) {
      throw AiMemoryException.invalid("메모리 내용은 1~" + MAX_CHARS + "자여야 해요");
    }
    return c;
  }

  /** 종류 검증 — PREFERENCE·CONTEXT 가 아니면 400 AI_MEMORY_INVALID. 되돌리기 복원도 같은 규칙을 쓰므로 패키지 공개. */
  static String requireKind(String kind) {
    if (kind == null || !KINDS.contains(kind)) {
      throw AiMemoryException.invalid("메모리 종류는 PREFERENCE 또는 CONTEXT 여야 해요");
    }
    return kind;
  }

  /** 범위 검증(WP-379) — null(공통) 또는 앱 6개. 그 밖("COMMON" 문자열 포함)은 400 AI_MEMORY_INVALID. */
  static String requireScope(String scope) {
    if (scope == null || AiMemoryScope.isApp(scope)) return scope;
    throw AiMemoryException.invalid(
        "메모리 범위는 " + String.join("·", AiMemoryScope.APPS) + " 중 하나이거나 비워 두어야 해요(비우면 공통)");
  }

  /** 저장 행 → 응답 항목(이전 값 없음 — JSON 에서 빠진다). */
  static AiMemoryItem toItem(Row r) {
    return toItem(r, null);
  }

  /** 저장 행 → 응답 항목. before 가 있으면(고치기·고침 복원) 이전 내용·종류·범위를 싣는다. */
  static AiMemoryItem toItem(Row r, Row before) {
    return new AiMemoryItem(
        r.id(),
        r.kind(),
        r.content(),
        r.source(),
        r.createdAt(),
        r.updatedAt(),
        before == null ? null : before.content(),
        before == null ? null : before.kind(),
        r.scope(),
        before == null ? null : before.scope());
  }

  /** 채팅 주입용 메모리 묶음(WP-55). */
  public record ChatMemories(boolean enabled, List<ChatMemory> items) {
    /** 꺼짐(빈 목록) — 사용자가 끈 경우와 조회 실패(판정 10 — 켜짐 + 빈 목록이면 AI 가 있는 메모리를 모른 채 중복 저장한다)가 함께 쓴다. */
    public static final ChatMemories DISABLED = new ChatMemories(false, List.of());
  }

  /** 블록 머리(제목 + 안내 문장, 한글 약 90자) 근사 토큰 + 여유. ai-agent memory-block.ts 의 문구가 바뀌면 함께 본다. */
  static final int BLOCK_HEADER_TOKENS = 120;

  /** 줄마다 붙는 "- [#123 선호] " 접두 근사 토큰. */
  static final int LINE_OVERHEAD_TOKENS = 12;

  /** 주입 순서 — updated_at 최신순, 같으면 id 큰 것 먼저(listNewest 와 같은 규칙). */
  private static final Comparator<Row> NEWEST_FIRST =
      Comparator.comparing(Row::updatedAt, Comparator.<Instant>reverseOrder())
          .thenComparing(Row::id, Comparator.<Long>reverseOrder());

  /**
   * 매 채팅 턴 주입할 메모리(WP-379) — 꺼져 있으면 빈 목록 + enabled=false. 켜져 있으면 공통 + app 범위를 범위마다 최신 50개씩 읽어(인덱스 각
   * 1회) 합친 뒤 최신순으로(최대 100개). 펌프 스레드·다른 진입점에서 불리며 테넌트는 TenantContext 가 정한다.
   *
   * @param app 지금 화면 앱 — null·모르는 값이면 공통만(판정 12)
   */
  @Transactional(readOnly = true)
  public ChatMemories loadForChat(long userId, String app) {
    if (!preferences.memoryEnabled(userId)) return ChatMemories.DISABLED;
    List<Row> rows = new ArrayList<>(repo.listInScope(userId, null, LIMIT));
    String a = AiMemoryScope.appOrNull(app);
    if (a != null) rows.addAll(repo.listInScope(userId, a, LIMIT));
    rows.sort(NEWEST_FIRST);
    return new ChatMemories(true, rows.stream().map(AiMemoryService::toChatMemory).toList());
  }

  /** 저장 행 → ai-agent 로 보내는 메모리(범위 포함 — 블록 줄의 "선호·이슈" 표기). */
  static ChatMemory toChatMemory(Row r) {
    return new ChatMemory(r.id(), r.kind(), r.content(), r.scope());
  }

  /** 메모리 블록 근사 토큰 — 문맥 예산에서 이전 대화 몫을 그만큼 줄인다(스펙 §3 채팅 주입 4). 비어 있으면 0(블록이 실리지 않는다). */
  public static int estimateBlockTokens(List<ChatMemory> items) {
    if (items.isEmpty()) return 0;
    int sum = BLOCK_HEADER_TOKENS;
    for (ChatMemory m : items) sum += TokenEstimates.estimate(m.content()) + LINE_OVERHEAD_TOKENS;
    return sum;
  }
}

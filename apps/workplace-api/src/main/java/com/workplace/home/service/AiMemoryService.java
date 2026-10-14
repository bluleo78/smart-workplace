package com.workplace.home.service;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.TokenEstimates;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.AiMemoryListResponse;
import com.workplace.home.dto.AiMemorySearchResponse;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.repository.HomeSessionRepository;
import com.workplace.home.repository.ScopeFilter;
import com.workplace.user.service.AiPreferenceService;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 메모리(WP-55) — 사용자가 대화에서 알려 준 교정·선호(PREFERENCE)와 업무 맥락(CONTEXT). 설정 화면 직접 관리와 AI 대행 도구가 같은
 * 규칙(1~300자 코드포인트, 범위마다 300개, 고정은 범위마다 10개(WP-383), 본인 것만)을 쓴다.
 *
 * <p>서버가 강제하는 것은 길이·상한·소유자·꺼짐까지다 — "사용자 본인 발화에서만 저장"은 ai-agent 시스템 프롬프트 규칙이다.
 *
 * <p>WP-380: 기한(expires_on) — 당일까지 유효, 한도·주입은 유효 행만. "오늘"은 {@link AiMemoryClock}.
 */
@Service
@RequiredArgsConstructor
public class AiMemoryService {

  /**
   * 범위(공통 또는 앱 하나)마다 상한 — WP-383 에서 50 → 300. 응답 limit 도 이 값("범위마다")이다. 매 턴 주입은 이 중 관련 있는 것만 고른다.
   */
  public static final int LIMIT = 300;

  /** 범위마다 고정 상한(WP-383) — 고정은 매 턴 늘 주입되므로 예산을 독점하지 않게 작게 둔다. 만료 행도 센다(판정 1). */
  public static final int PIN_LIMIT = 10;

  /**
   * 설정 목록에 싣는 만료 행 최대 개수(최신순). 만료 행은 한도가 없고 정리 배치가 지우기 전 30일 동안 남아, AI 가 짧은 기한 메모리를 많이 만들면 끝없이 쌓일 수
   * 있다 — 유효 행(범위마다 300 이하)은 모두 싣고 만료 행만 이 수로 자른다. 오래된 만료 행은 목록에서만 빠지고 곧 지워진다.
   */
  static final int EXPIRED_LIST_CAP = 100;

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

  /** 기한 형식 — 연도 네 자리 yyyy-MM-dd. 웹·ai-agent·ChatBlockRecorder 와 같은 규칙이다. */
  private static final Pattern DATE_PATTERN = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

  private final AiMemoryRepository repo;
  private final AiPreferenceService preferences;
  private final HomeSessionRepository sessionRepo;
  private final AiMemoryClock clock;
  private final ApplicationEventPublisher events;
  private final AiMemorySelector selector;

  /** 내용이 새로 생기거나 바뀐 메모리의 임베딩을 커밋 뒤에 채우게 한다(WP-383) — 롤백되면 이벤트도 사라진다. */
  private void requestEmbedding(long memoryId) {
    events.publishEvent(
        new TextEmbeddingService.Requested(
            TenantContext.get(), TextEmbeddingService.Target.MEMORY, memoryId));
  }

  /**
   * 본인 메모리 목록(범위 무관 최신순) + 범위마다 상한 — 웹이 범위별로 묶어 개수·가득 참을 센다. 유효 행은 모두, 만료 행(expired 표시)은 최신
   * EXPIRED_LIST_CAP 개까지 — 만료 행이 상한을 나눠 써서 오래된 유효 행이 빠지면 웹의 범위별 개수가 틀린다.
   */
  @Transactional(readOnly = true)
  public AiMemoryListResponse list(long userId) {
    LocalDate today = clock.today();
    List<Row> rows = new ArrayList<>(repo.listActive(userId, today));
    rows.addAll(repo.listExpired(userId, today, EXPIRED_LIST_CAP));
    rows.sort(AiMemoryRanker.NEWEST);
    return new AiMemoryListResponse(
        rows.stream().map(r -> toItem(r, null, today)).toList(), LIMIT, PIN_LIMIT);
  }

  /**
   * 생성 — internal(ai-agent 대행)일 때만 source:'AI' 와 세션을 받는다. 세션은 호출자 소유일 때만 기록한다(남의 세션 id 를 실어도 null).
   * WP-379: scope(null = 공통)를 검증하고 그 범위의 상한을 센다. WP-380: 기한(yyyy-MM-dd)을 검증하고(오늘 이전·형식 오류 400) 유효로
   * 들어갈 때만 상한을 센다.
   *
   * @throws AiMemoryException 409 DISABLED(대행 + 꺼짐), 409 FULL(+scope), 400
   */
  @Transactional
  public AiMemoryItem create(long userId, CreateAiMemoryRequest req, boolean internal) {
    if (internal) requireEnabled(userId);
    boolean ai = internal && SOURCE_AI.equals(req.source());
    UUID session = ai ? ownedSession(userId, req.sessionId()) : null;
    String scope = requireScope(req.scope());
    LocalDate today = clock.today();
    LocalDate expiresOn = parseExpiresOn(req.expiresOn(), today);
    NewMemory m =
        new NewMemory(
            req.kind(), req.content(), ai ? SOURCE_AI : SOURCE_USER, session, scope, expiresOn);
    return toItem(insertChecked(userId, m, null, today), null, today);
  }

  /**
   * 고치기 — 생략한 필드는 그대로(scope 는 present-flag, null = 공통). 대행이면 꺼짐 409. 응답에 이전 내용·종류·범위를
   * 싣는다(update_memory 결과·채팅 되돌리기 근거). 그 범위에서 새로 유효해질 때(다른 범위로 옮기기·만료 행 되살리기)만 대상 범위 상한을 센다(같은 범위 안
   * 고치기, 만료인 채 내용만 고치기는 가득 찬 범위에서도 된다). WP-380: expiresOn 지정·clearExpiry(없애기, 동시 지정은 400).
   *
   * @throws AiMemoryException 400(바꿀 값 없음·검증 실패), 404(없음·남의 것), 409(대행 + 꺼짐, 대상 범위 가득)
   */
  @Transactional
  public AiMemoryItem update(long userId, long id, UpdateAiMemoryRequest req, boolean internal) {
    if (internal) requireEnabled(userId);
    if (req == null || !req.hasChanges()) throw AiMemoryException.invalid("바꿀 내용이 없어요");
    if (req.expiresOn() != null && req.clearExpiry()) {
      throw AiMemoryException.invalid("기한 지정과 기한 없애기를 함께 보낼 수 없어요");
    }
    LocalDate today = clock.today();
    String targetScope = req.hasScope() ? requireScope(req.scope()) : null;
    LocalDate newExpiry = parseExpiresOn(req.expiresOn(), today);
    // 범위·기한이 바뀌면 그 범위 유효 개수를 셀 수 있다 — 행 잠금보다 사용자 잠금을 먼저 잡는다(생성·되돌리기와 같은 순서라 교착이 없다).
    if (req.hasScope() || req.changesExpiry()) repo.lockUser(userId);
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::notFound);
    String c = req.content() == null ? cur.content() : normalizeContent(req.content());
    String k = req.kind() == null ? cur.kind() : requireKind(req.kind());
    String s = req.hasScope() ? targetScope : cur.scope();
    LocalDate e = req.clearExpiry() ? null : req.expiresOn() != null ? newExpiry : cur.expiresOn();
    requireRoomIfActivating(userId, cur, s, e, today);
    // WP-383: 고정 행을 다른 범위로 옮기면 그 범위의 고정 상한을 센다(판정 1) — 범위를 바꾸는 요청이라 사용자 잠금은 이미 잡았다.
    requirePinRoomIfMoving(userId, cur, s);
    Row saved = repo.update(userId, id, k, c, s, e).orElseThrow(AiMemoryException::notFound);
    if (!cur.content().equals(saved.content())) requestEmbedding(id);
    return toItem(saved, cur, today);
  }

  /** 지우기 — 대행이면 꺼짐 409. 지운 항목을 돌려준다(forget_memory 결과·설정 "되돌리기" 토스트 근거 — 범위 포함). */
  @Transactional
  public AiMemoryItem delete(long userId, long id, boolean internal) {
    if (internal) requireEnabled(userId);
    return toItem(
        repo.delete(userId, id).orElseThrow(AiMemoryException::notFound), null, clock.today());
  }

  /**
   * 되돌리기용 재생성(지움 결과 줄 forgotten) — 꺼짐과 무관(사용자가 직접 하는 정리), 같은 source·범위·기한, <b>원래 id 로</b> 다시 만든다 —
   * 새 id 면 같은 메모리를 가리키던 앞선 결과 줄(saved·updated)의 되돌리기가 엉뚱하게 "이미 없음"으로 끝나고 되살린 메모리는 남는다. 이미 쓰였으면(같은
   * 메모리를 다른 줄로 이미 되살림 등) 새 id 로 만든다. 기한이 이미 지났으면 만료 상태로 다시 만들고 한도·과거 기한 400 을 적용하지 않는다(기한 30일 뒤 정리
   * 배치가 지운다). 유효로 되살아나면 그 범위 상한을 센다.
   *
   * @param scope 블록의 범위(null = 공통 — 구 블록 포함)
   * @param expiresOn 블록의 기한(yyyy-MM-dd, null = 기한 없음 — 구 블록 포함)
   */
  @Transactional
  public AiMemoryItem restore(
      long userId,
      long memoryId,
      String kind,
      String content,
      String source,
      String scope,
      String expiresOn) {
    String s = SOURCE_AI.equals(source) ? SOURCE_AI : SOURCE_USER;
    LocalDate today = clock.today();
    NewMemory m = new NewMemory(kind, content, s, null, requireScope(scope), dateOrNull(expiresOn));
    return toItem(insertChecked(userId, m, memoryId, today), null, today);
  }

  /** 되돌리기용 삭제(saved) — 이미 없으면 false(그대로 진행). */
  @Transactional
  public boolean deleteIfExists(long userId, long id) {
    return repo.delete(userId, id).isPresent();
  }

  /**
   * 되돌리기 비교·복원의 한쪽 값. kind 가 null 이면 "모름", scope 가 null 이면 공통, expiresOn(yyyy-MM-dd)이 null 이면 기한
   * 없음.
   */
  public record Snapshot(String content, String kind, String scope, String expiresOn) {}

  /**
   * 되돌리기용 고침 복원(updated). 이미 없으면 404 AI_MEMORY_GONE. 그 고침 뒤에 다시 바뀌었으면 409 AI_MEMORY_CHANGED — 지금
   * 내용·범위·기한 ≠ 고친 값, 이전 종류가 기록된 줄이면 종류도(구 블록은 공통·기한 없음으로 본다). 이전 종류(있으면)·범위·기한으로 돌려놓는다. 그 결과 다른
   * 범위에서 새로 유효해지면(범위 이동·만료 → 유효) 그 범위가 가득일 때 409 FULL. 이전 기한이 이미 지났으면 만료 상태로 돌아간다.
   */
  @Transactional
  public AiMemoryItem restoreContent(long userId, long id, Snapshot after, Snapshot before) {
    LocalDate today = clock.today();
    // 범위 이동·되살아남이 생길 수 있어 사용자 잠금을 먼저 잡는다(update·insertChecked 와 같은 순서).
    repo.lockUser(userId);
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::gone);
    boolean kindChanged = before.kind() != null && !cur.kind().equals(after.kind());
    if (!cur.content().equals(after.content())
        || kindChanged
        || !Objects.equals(cur.scope(), after.scope())
        || !Objects.equals(cur.expiresOn(), dateOrNull(after.expiresOn()))) {
      throw AiMemoryException.changed();
    }
    String k = before.kind() == null ? cur.kind() : requireKind(before.kind());
    String s = requireScope(before.scope());
    LocalDate e = dateOrNull(before.expiresOn());
    requireRoomIfActivating(userId, cur, s, e, today);
    // 범위 이동 되돌리기로 고정 행이 고정이 가득 찬 범위로 들어가 상한을 넘는 우회를 막는다(update 와 같은 규칙).
    requirePinRoomIfMoving(userId, cur, s);
    Row saved =
        repo.update(userId, id, k, normalizeContent(before.content()), s, e)
            .orElseThrow(AiMemoryException::gone);
    if (!cur.content().equals(saved.content())) requestEmbedding(id);
    return toItem(saved, cur, today);
  }

  /**
   * 고정 켜기·끄기(WP-383, 판정 1·2) — 사용자 전용(대행이면 403). 켤 때만 그 범위의 고정 수(만료 포함)를 센다. 사용자 잠금 → 행 잠금 순서는
   * 생성·고치기와 같다(동시 고정 두 건이 모두 9개를 보고 11개가 되지 않게). updated_at 은 그대로라 설정 목록 최신순·주입 최신 순위가 바뀌지 않는다.
   *
   * @throws AiMemoryException 403 PIN_USER_ONLY, 400(pinned 없음), 404(없음·남의 것), 409 PIN_FULL(+scope)
   */
  @Transactional
  public AiMemoryItem setPinned(long userId, long id, Boolean pinned, boolean internal) {
    if (internal) throw AiMemoryException.pinUserOnly();
    if (pinned == null) throw AiMemoryException.invalid("pinned 를 true 나 false 로 보내 주세요");
    repo.lockUser(userId);
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::notFound);
    if (pinned && !cur.pinned() && repo.countPinnedInScope(userId, cur.scope()) >= PIN_LIMIT) {
      throw AiMemoryException.pinFull(cur.scope());
    }
    Row saved = repo.setPinned(userId, id, pinned).orElseThrow(AiMemoryException::notFound);
    return toItem(saved, null, clock.today());
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

  /** 유효 행인가 — 기한 없음 또는 기한 ≥ 오늘(당일까지 유효). */
  static boolean isActive(LocalDate expiresOn, LocalDate today) {
    return expiresOn == null || !expiresOn.isBefore(today);
  }

  /**
   * 결과가 유효하고 "그 범위에서 새로 유효해질 때"만 그 범위 유효 개수를 센다 — 다른 범위로 옮기거나 만료 행이 되살아날 때. 같은 범위에서 이미 유효하던 행의 고치기,
   * 만료인 채 남는 고치기는 한도와 무관하다. 호출자가 사용자 잠금을 이미 잡았다.
   */
  private void requireRoomIfActivating(
      long userId, Row cur, String targetScope, LocalDate targetExpiry, LocalDate today) {
    if (!isActive(targetExpiry, today)) return;
    if (isActive(cur.expiresOn(), today) && Objects.equals(cur.scope(), targetScope)) return;
    if (repo.countInScope(userId, targetScope, today) >= LIMIT) {
      throw AiMemoryException.full(targetScope);
    }
  }

  /** 고정 행이 다른 범위로 옮겨 갈 때 대상 범위의 고정 상한(만료 포함)을 센다 — 호출자가 사용자 잠금을 이미 잡았다. */
  private void requirePinRoomIfMoving(long userId, Row cur, String targetScope) {
    if (cur.pinned()
        && !Objects.equals(cur.scope(), targetScope)
        && repo.countPinnedInScope(userId, targetScope) >= PIN_LIMIT) {
      throw AiMemoryException.pinFull(targetScope);
    }
  }

  /**
   * 검증 → 사용자 잠금 → (유효로 들어가면) 그 범위 유효 개수 상한 → 저장(preferredId 가 있으면 그 id 를 먼저 시도). 잠금을 먼저 잡아야 동시 요청 두
   * 건이 모두 49개를 보고 51개가 되는 일을 막는다(READ COMMITTED 에서 잠금 뒤 count 는 앞 요청의 커밋을 본다). 만료 상태로 다시 만드는 되살리기는
   * 한도에 들지 않는다. 범위·기한은 호출자가 이미 검증했고, 종류·내용은 여기서 검증·정리한다.
   */
  Row insertChecked(long userId, NewMemory raw, Long preferredId, LocalDate today) {
    NewMemory m =
        new NewMemory(
            requireKind(raw.kind()),
            normalizeContent(raw.content()),
            raw.source(),
            raw.sessionId(),
            raw.scope(),
            raw.expiresOn());
    repo.lockUser(userId);
    if (isActive(m.expiresOn(), today) && repo.countInScope(userId, m.scope(), today) >= LIMIT) {
      throw AiMemoryException.full(m.scope());
    }
    // 되살리기(preferredId)는 원래 id 를 먼저 시도하고, 쓸 수 없으면 새 id 로 만든다.
    Row saved = null;
    if (preferredId != null) saved = repo.insertWithId(preferredId, userId, m).orElse(null);
    if (saved == null) saved = repo.insert(userId, m);
    requestEmbedding(saved.id());
    return saved;
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

  /**
   * 요청의 새 기한 검증 — null(키 없음)이면 null(기한 없음). 그 밖에는 연도 네 자리 yyyy-MM-dd 의 실제 날짜여야 하고 오늘 이전이면 400(먼 미래
   * 제한 없음). 빈 문자열도 400 이다 — 기한 없애기는 clearExpiry 로만 한다.
   */
  static LocalDate parseExpiresOn(String raw, LocalDate today) {
    if (raw == null) return null;
    LocalDate d = strictDate(raw);
    if (d.isBefore(today)) {
      throw AiMemoryException.invalid("기한은 오늘이나 그 이후 날짜여야 해요");
    }
    return d;
  }

  /**
   * 되돌리기 블록의 기한 → 날짜(null·빈 값은 null — 기한이 없던 구 블록). 블록 기한은 기록 시점(ChatBlockRecorder)에 이미 같은 형식으로
   * 걸러졌고, 지난 날짜도 그대로 받는다(만료 상태로 복원).
   */
  static LocalDate dateOrNull(String raw) {
    if (raw == null || raw.isBlank()) return null;
    return strictDate(raw);
  }

  /**
   * 연도 네 자리 yyyy-MM-dd 의 실제 날짜만 받는다. LocalDate.parse 는 부호 붙은 큰 연도(+12026-01-01)도 받는데, DB 상한을 넘으면
   * 500 이고 그 아래면 저장돼도 웹 날짜 표기·ai-agent 주입(같은 정규식)에서 빠지므로 여기서 400 으로 막는다. 없는 날짜(2026-02-30)도 400.
   */
  private static LocalDate strictDate(String raw) {
    if (!isStrictDate(raw)) {
      throw AiMemoryException.invalid("기한은 yyyy-MM-dd 형식의 실제 날짜여야 해요");
    }
    return LocalDate.parse(raw);
  }

  /**
   * 연도 네 자리 yyyy-MM-dd 의 실제 날짜인가 — 요청 기한 검증({@link #strictDate})과 결과 줄 기록(ChatBlockRecorder)이 같은 규칙
   * 하나를 쓴다. 정규식은 미리 컴파일해 둔 것을 쓴다.
   */
  static boolean isStrictDate(String raw) {
    if (raw == null || !DATE_PATTERN.matcher(raw).matches()) return false;
    try {
      LocalDate.parse(raw);
      return true;
    } catch (DateTimeParseException e) {
      return false;
    }
  }

  /** 저장 행 → 응답 항목. before 가 있으면(고치기·고침 복원) 이전 내용·종류·범위·기한을 싣는다. expired 는 today 기준. */
  static AiMemoryItem toItem(Row r, Row before, LocalDate today) {
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
        before == null ? null : before.scope(),
        r.expiresOn(),
        !isActive(r.expiresOn(), today),
        before == null ? null : before.expiresOn(),
        r.pinned());
  }

  /**
   * 채팅 주입용 메모리 묶음(WP-55·383).
   *
   * @param today 이 묶음을 고른 서버 오늘(Asia/Seoul, yyyy-MM-dd) — ChatRequest.today(블록의 오늘 줄·기한 계산 근거)로 그대로
   *     보낸다. 꺼짐이면 null(ai-agent 는 꺼짐이면 오늘을 쓰지 않는다)
   * @param moreCount 블록에 넣지 않은 유효 메모리 수(다른 범위 포함, WP-383) — 홈 채팅만 "더 있음" 줄로 보낸다
   */
  public record ChatMemories(
      boolean enabled, List<AiMemoryLine> items, String today, int moreCount) {
    /** 꺼짐(빈 목록) — 사용자가 끈 경우와 조회 실패(판정 10 — 켜짐 + 빈 목록이면 AI 가 있는 메모리를 모른 채 중복 저장한다)가 함께 쓴다. */
    public static final ChatMemories DISABLED = new ChatMemories(false, List.of(), null, 0);
  }

  /**
   * 블록 머리(제목 + 안내 문장, 한글 약 90자) 근사 토큰 + 여유. ai-agent memory-block.ts 의 문구가 바뀌면 함께 본다. 범위 안내·오늘
   * 줄(WP-379·380)이 더해지면 실제 머리는 이 값보다 약 40토큰 크다 — 이전 대화 몫을 그만큼 덜 줄이는 과소 추정이지만 허용 범위라 값은 그대로 둔다(올리면
   * 기존 예산 테스트가 깨진다).
   */
  static final int BLOCK_HEADER_TOKENS = 120;

  /**
   * 켜짐 + 메모리 0개일 때의 블록 근사 토큰 + 여유. 홈 채팅은 늘 서버 오늘을 보내므로 ai-agent memory-block.ts 는 이때도 머리·"아직 저장된
   * 메모리가 없다. 지금 화면: …"·오늘 줄 세 줄(TokenEstimates 로 약 45토큰)을 싣는다 — 0 으로 세면 그만큼 예산을 넘긴다. 문구가 바뀌면 함께 본다.
   */
  static final int EMPTY_BLOCK_TOKENS = 50;

  /** 줄마다 붙는 "- [#123 선호] " 접두 근사 토큰. */
  static final int LINE_OVERHEAD_TOKENS = 12;

  /** 매 턴 블록 토큰 예산(WP-383) — 고정 → 순위 순으로 이 안에서 자른다. 머리·"더 있음" 줄 몫을 먼저 뺀다. */
  public static final int MEMORY_BLOCK_TOKEN_BUDGET = 2_000;

  /** 채팅·다른 진입점의 질의 임베딩 대기(WP-383) — 넘기면 키워드 + 최신으로 고른다. */
  static final Duration CHAT_EMBED_WAIT = Duration.ofMillis(1_500);

  /** "이 밖에 메모리 N개가 더 있어요(다른 앱 범위 포함). 필요하면 search_memory 로 찾아 보세요." 줄 근사 토큰(한글 약 45자) + 여유. */
  static final int MORE_LINE_TOKENS = 50;

  /** 줄 라벨 "·고정" 근사 토큰. */
  static final int PIN_LABEL_TOKENS = 3;

  /**
   * 홈 채팅 매 턴 주입(WP-383) — 공통 + app(null 이면 공통만) 중 관련 있는 것을 고른다(AiMemorySelector). 펌프 스레드에서 불리며 테넌트는
   * TenantContext 가 정한다. 바깥 트랜잭션이 있으면 참여한다(테스트).
   *
   * @param app 지금 화면 앱 — 호출자가 이미 거른 앱 코드({@link AiMemoryScope#appOrNull}). null 이면 공통만
   * @param queryText 이번 사용자 메시지 — 비면 고정 + 최신
   */
  public ChatMemories loadForChat(long userId, String app, String queryText) {
    return toChatMemories(
        selector.select(
            userId,
            ScopeFilter.chat(app),
            queryText,
            CHAT_EMBED_WAIT,
            MEMORY_BLOCK_TOKEN_BUDGET,
            false));
  }

  /**
   * 다른 진입점(WP-381·383) — 규칙은 홈 채팅과 같고 읽기 트랜잭션을 늘 새로 연다(AiMemoryReader#readForEntry). moreCount 는 쓰지
   * 않는다(검색 도구가 없다).
   */
  public ChatMemories loadForEntry(long userId, String app, String queryText) {
    return toChatMemories(
        selector.select(
            userId,
            ScopeFilter.chat(app),
            queryText,
            CHAT_EMBED_WAIT,
            MEMORY_BLOCK_TOKEN_BUDGET,
            true));
  }

  /** 검색(search_memory) 질의 임베딩 대기 — 도구 호출이라 채팅 첫 토큰보다 덜 급하다. */
  static final Duration SEARCH_EMBED_WAIT = Duration.ofSeconds(5);

  /** 검색 기본 개수. */
  static final int SEARCH_DEFAULT_LIMIT = 10;

  /** 검색 최대 개수. */
  static final int SEARCH_MAX_LIMIT = 20;

  /**
   * 메모리 검색(WP-383 스펙 3.6) — 본인 유효 메모리 중 키워드·의미 갈래에 든 것을 RRF 순으로. 꺼짐이면 memoryEnabled=false + 빈
   * 목록(대행· 사용자 모두 — 읽기라 409 로 막지 않는다).
   *
   * @param scope null·ALL = 전부, COMMON = 공통만, 앱 코드 = 그 앱만
   * @param limit 기본 10, 1~20 으로 묶는다
   * @throws AiMemoryException 400 — 빈 질의(판정 9)·모르는 범위
   */
  public AiMemorySearchResponse search(long userId, String q, String scope, Integer limit) {
    if (q == null || q.isBlank()) throw AiMemoryException.invalid("찾을 말을 넣어 주세요");
    ScopeFilter filter = searchScope(scope);
    int n = limit == null ? SEARCH_DEFAULT_LIMIT : Math.max(1, Math.min(limit, SEARCH_MAX_LIMIT));
    AiMemorySelector.Found found = selector.search(userId, filter, q, SEARCH_EMBED_WAIT, n);
    return new AiMemorySearchResponse(
        found.enabled(), found.rows().stream().map(AiMemoryService::toMemoryLine).toList());
  }

  /** 검색 범위 문자열 → 필터. 모르는 값은 400(조용히 전부로 넓히지 않는다). */
  static ScopeFilter searchScope(String scope) {
    if (scope == null || scope.isBlank() || "ALL".equals(scope)) return ScopeFilter.ALL;
    if (AiMemoryScope.COMMON.equals(scope)) return ScopeFilter.commonOnly();
    if (AiMemoryScope.isApp(scope)) return ScopeFilter.app(scope);
    throw AiMemoryException.invalid(
        "scope 는 ALL·COMMON·앱 코드(" + String.join("·", AiMemoryScope.APPS) + ") 중 하나예요");
  }

  private static ChatMemories toChatMemories(AiMemorySelector.Selection s) {
    if (!s.enabled()) return ChatMemories.DISABLED;
    return new ChatMemories(
        true,
        s.rows().stream().map(AiMemoryService::toMemoryLine).toList(),
        s.today().toString(),
        s.moreCount());
  }

  /** 블록 한 줄 근사 토큰 — 내용 + 접두(+ 고정 라벨). 선택기의 예산 자르기와 블록 추정이 같은 값을 쓴다. */
  static int lineTokens(String content, boolean pinned) {
    return TokenEstimates.estimate(content)
        + LINE_OVERHEAD_TOKENS
        + (pinned ? PIN_LABEL_TOKENS : 0);
  }

  /** 저장 행 → ai-agent 로 보내는 메모리(범위·기한·고정 포함 — 블록 줄의 "선호·이슈·고정"·"(10/24까지)" 표기). */
  static AiMemoryLine toMemoryLine(Row r) {
    return new AiMemoryLine(
        r.id(),
        r.kind(),
        r.content(),
        r.scope(),
        r.expiresOn() == null ? null : r.expiresOn().toString(),
        r.pinned() ? Boolean.TRUE : null);
  }

  /**
   * 메모리 블록 근사 토큰 — 문맥 예산에서 이전 대화 몫을 그만큼 줄인다. 꺼짐이면 0, 켜짐 + 0개면 빈 블록 몫, 그 밖에는 머리 + 줄마다 내용·접두·고정 라벨.
   * "더 있음" 줄이 실리면(moreCount > 0) 그 몫을 더한다.
   */
  public static int estimateBlockTokens(ChatMemories memories) {
    if (!memories.enabled()) return 0;
    int more = memories.moreCount() > 0 ? MORE_LINE_TOKENS : 0;
    if (memories.items().isEmpty()) return EMPTY_BLOCK_TOKENS + more;
    int sum = BLOCK_HEADER_TOKENS + more;
    for (AiMemoryLine m : memories.items()) {
      sum += lineTokens(m.content(), Boolean.TRUE.equals(m.pinned()));
    }
    return sum;
  }
}

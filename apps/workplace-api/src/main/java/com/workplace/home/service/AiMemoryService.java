package com.workplace.home.service;

import com.workplace.global.util.TokenEstimates;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.AiMemoryListResponse;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.outbound.ChatMessages.ChatMemory;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.repository.HomeSessionRepository;
import com.workplace.user.service.AiPreferenceService;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 메모리(WP-55) — 사용자가 대화에서 알려 준 교정·선호(PREFERENCE)와 업무 맥락(CONTEXT). 설정 화면 직접 관리와 AI 대행 도구가 같은
 * 규칙(1~300자 코드포인트, 사용자당 50개, 본인 것만)을 쓴다.
 *
 * <p>서버가 강제하는 것은 길이·상한·소유자·꺼짐까지다 — "사용자 본인 발화에서만 저장"은 ai-agent 시스템 프롬프트 규칙이다.
 */
@Service
@RequiredArgsConstructor
public class AiMemoryService {

  /** 사용자(테넌트 안)당 상한 — 매 턴 전부 주입해도 예산에 부담이 없는 크기(스펙 §1 비목표: 의미 검색 대신 전체 주입). */
  public static final int LIMIT = 50;

  /** 내용 최대 길이(코드포인트). DB VARCHAR(300) 과 같다. */
  public static final int MAX_CHARS = 300;

  public static final String KIND_PREFERENCE = "PREFERENCE";
  public static final String KIND_CONTEXT = "CONTEXT";
  public static final String SOURCE_AI = "AI";
  public static final String SOURCE_USER = "USER";

  private static final Set<String> KINDS = Set.of(KIND_PREFERENCE, KIND_CONTEXT);

  private final AiMemoryRepository repo;
  private final AiPreferenceService preferences;
  private final HomeSessionRepository sessionRepo;

  /** 본인 메모리 목록(최신순, 최대 50). */
  @Transactional(readOnly = true)
  public AiMemoryListResponse list(long userId) {
    return new AiMemoryListResponse(
        repo.listNewest(userId, LIMIT).stream().map(r -> toItem(r, null)).toList(), LIMIT);
  }

  /** 직접 추가(설정 화면) — 항상 USER 출처. 테스트·내부 호출용 축약. */
  @Transactional
  public AiMemoryItem create(long userId, String kind, String content) {
    return create(userId, new CreateAiMemoryRequest(kind, content, null, null), false);
  }

  /**
   * 생성 — internal(ai-agent 대행)일 때만 source:'AI' 와 세션을 받는다. 세션은 호출자 소유일 때만 기록한다(남의 세션 id 를 실어도 null).
   *
   * @throws AiMemoryException 409 DISABLED(대행 + 꺼짐), 409 FULL, 400
   */
  @Transactional
  public AiMemoryItem create(long userId, CreateAiMemoryRequest req, boolean internal) {
    if (internal) requireEnabled(userId);
    boolean ai = internal && SOURCE_AI.equals(req.source());
    UUID session = ai ? ownedSession(userId, req.sessionId()) : null;
    return toItem(
        insertChecked(userId, req.kind(), req.content(), ai ? SOURCE_AI : SOURCE_USER, session),
        null);
  }

  /** 고치기(설정 화면) — 축약. */
  @Transactional
  public AiMemoryItem update(long userId, long id, String content, String kind) {
    return update(userId, id, content, kind, false);
  }

  /**
   * 고치기 — 생략한 필드는 그대로. 대행이면 꺼짐 409. 응답에 이전 내용(previousContent)을 싣는다(update_memory 결과·채팅 되돌리기 근거).
   *
   * @throws AiMemoryException 400(둘 다 없음·검증 실패), 404(없음·남의 것), 409(대행 + 꺼짐)
   */
  @Transactional
  public AiMemoryItem update(long userId, long id, String content, String kind, boolean internal) {
    if (internal) requireEnabled(userId);
    if (content == null && kind == null) throw AiMemoryException.invalid("바꿀 내용이 없어요");
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::notFound);
    String c = content == null ? cur.content() : normalizeContent(content);
    String k = kind == null ? cur.kind() : requireKind(kind);
    Row saved = repo.update(userId, id, k, c).orElseThrow(AiMemoryException::notFound);
    return toItem(saved, cur.content());
  }

  /** 지우기(설정 화면) — 축약. */
  @Transactional
  public AiMemoryItem delete(long userId, long id) {
    return delete(userId, id, false);
  }

  /** 지우기 — 대행이면 꺼짐 409. 지운 항목을 돌려준다(forget_memory 결과·설정 "되돌리기" 토스트 근거). */
  @Transactional
  public AiMemoryItem delete(long userId, long id, boolean internal) {
    if (internal) requireEnabled(userId);
    return toItem(repo.delete(userId, id).orElseThrow(AiMemoryException::notFound), null);
  }

  /** 되돌리기용 재생성(WP-55 §6 forgotten) — 꺼짐과 무관(사용자가 직접 하는 정리), 상한만 검사, 같은 source. */
  @Transactional
  public AiMemoryItem restore(long userId, String kind, String content, String source) {
    String s = SOURCE_AI.equals(source) ? SOURCE_AI : SOURCE_USER;
    return toItem(insertChecked(userId, kind, content, s, null), null);
  }

  /** 되돌리기용 삭제(saved) — 이미 없으면 false(그대로 진행). */
  @Transactional
  public boolean deleteIfExists(long userId, long id) {
    return repo.delete(userId, id).isPresent();
  }

  /** 되돌리기용 내용 복원(updated) — 이미 없으면 404 AI_MEMORY_GONE. */
  @Transactional
  public AiMemoryItem restoreContent(long userId, long id, String previousContent) {
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::gone);
    Row saved =
        repo.update(userId, id, cur.kind(), normalizeContent(previousContent))
            .orElseThrow(AiMemoryException::gone);
    return toItem(saved, cur.content());
  }

  /** 모두 지우기 — 본인 것만. */
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

  /**
   * 검증 → 사용자 잠금 → 상한 확인 → 저장. 잠금을 먼저 잡아야 동시 요청 두 건이 모두 49개를 보고 51개가 되는 일을 막는다(READ COMMITTED 에서 잠금
   * 뒤 count 는 앞 요청의 커밋을 본다).
   */
  Row insertChecked(long userId, String kind, String content, String source, UUID sessionId) {
    String k = requireKind(kind);
    String c = normalizeContent(content);
    repo.lockUser(userId);
    if (repo.count(userId) >= LIMIT) throw AiMemoryException.full();
    return repo.insert(userId, k, c, source, sessionId);
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

  static String requireKind(String kind) {
    if (kind == null || !KINDS.contains(kind)) {
      throw AiMemoryException.invalid("메모리 종류는 PREFERENCE 또는 CONTEXT 여야 해요");
    }
    return kind;
  }

  static AiMemoryItem toItem(Row r, String previousContent) {
    return new AiMemoryItem(
        r.id(), r.kind(), r.content(), r.source(), r.createdAt(), r.updatedAt(), previousContent);
  }

  /** 채팅 주입용 메모리 묶음(WP-55). */
  public record ChatMemories(boolean enabled, List<ChatMemory> items) {
    /** 조회 실패 — 꺼짐으로 보낸다(켜짐 + 빈 목록이면 AI 가 있는 메모리를 모른 채 중복 저장한다, 판정 10). */
    public static final ChatMemories UNAVAILABLE = new ChatMemories(false, List.of());
  }

  /** 블록 머리(제목 + 안내 문장, 한글 약 90자) 근사 토큰 + 여유. ai-agent memory-block.ts 의 문구가 바뀌면 함께 본다. */
  static final int BLOCK_HEADER_TOKENS = 120;

  /** 줄마다 붙는 "- [#123 선호] " 접두 근사 토큰. */
  static final int LINE_OVERHEAD_TOKENS = 12;

  /**
   * 매 채팅 턴 주입할 메모리 — 꺼져 있으면 빈 목록 + enabled=false, 켜져 있으면 최신순 최대 50개(인덱스 1회). 펌프 스레드에서 불리며 테넌트는
   * TenantContextTaskDecorator 가 전파한다.
   */
  @Transactional(readOnly = true)
  public ChatMemories loadForChat(long userId) {
    if (!preferences.memoryEnabled(userId)) return new ChatMemories(false, List.of());
    return new ChatMemories(
        true,
        repo.listNewest(userId, LIMIT).stream()
            .map(r -> new ChatMemory(r.id(), r.kind(), r.content()))
            .toList());
  }

  /** 메모리 블록 근사 토큰 — 문맥 예산에서 이전 대화 몫을 그만큼 줄인다(스펙 §3 채팅 주입 4). 비어 있으면 0(블록이 실리지 않는다). */
  public static int estimateBlockTokens(List<ChatMemory> items) {
    if (items.isEmpty()) return 0;
    int sum = BLOCK_HEADER_TOKENS;
    for (ChatMemory m : items) sum += TokenEstimates.estimate(m.content()) + LINE_OVERHEAD_TOKENS;
    return sum;
  }
}

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
import java.util.Optional;
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
  static final int LIMIT = 50;

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

  /** 본인 메모리 목록(최신순, 최대 50). */
  @Transactional(readOnly = true)
  public AiMemoryListResponse list(long userId) {
    return new AiMemoryListResponse(
        repo.listNewest(userId, LIMIT).stream().map(AiMemoryService::toItem).toList(), LIMIT);
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
        insertChecked(
            userId, req.kind(), req.content(), ai ? SOURCE_AI : SOURCE_USER, session, null));
  }

  /**
   * 고치기 — 생략한 필드는 그대로. 대행이면 꺼짐 409. 응답에 이전 내용·종류(previousContent·previousKind)를 싣는다(update_memory
   * 결과·채팅 되돌리기 근거 — AI 가 종류까지 바꿨으면 되돌리기가 종류도 돌려놓는다).
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
    return toItem(saved, cur.content(), cur.kind());
  }

  /** 지우기 — 대행이면 꺼짐 409. 지운 항목을 돌려준다(forget_memory 결과·설정 "되돌리기" 토스트 근거). */
  @Transactional
  public AiMemoryItem delete(long userId, long id, boolean internal) {
    if (internal) requireEnabled(userId);
    return toItem(repo.delete(userId, id).orElseThrow(AiMemoryException::notFound));
  }

  /**
   * 되돌리기용 재생성(WP-55 §6 forgotten) — 꺼짐과 무관(사용자가 직접 하는 정리), 상한만 검사, 같은 source. <b>원래 id 로</b> 다시 만든다
   * — 새 id 면 같은 메모리를 가리키던 앞선 결과 줄(saved·updated)의 되돌리기가 엉뚱하게 "이미 없음"으로 끝나고 되살린 메모리는 남는다. id 는 단조 증가
   * 시퀀스에서 나오고 그 행은 지워졌으므로 대개 비어 있다 — 이미 쓰였으면(같은 메모리를 다른 줄로 이미 되살림 등) 새 id 로 만든다.
   */
  @Transactional
  public AiMemoryItem restore(
      long userId, long memoryId, String kind, String content, String source) {
    String s = SOURCE_AI.equals(source) ? SOURCE_AI : SOURCE_USER;
    return toItem(insertChecked(userId, kind, content, s, null, memoryId));
  }

  /** 되돌리기용 삭제(saved) — 이미 없으면 false(그대로 진행). */
  @Transactional
  public boolean deleteIfExists(long userId, long id) {
    return repo.delete(userId, id).isPresent();
  }

  /**
   * 되돌리기용 고침 복원(updated). 이미 없으면 404 AI_MEMORY_GONE. 그 고침 뒤에 다시 바뀌었으면(지금 내용 ≠ 고친 내용, 이전 종류가 기록된 줄이면
   * 지금 종류 ≠ 고친 종류도) 409 AI_MEMORY_CHANGED — 되돌리면 그 뒤의 수정을 조용히 덮는다. 이전 종류(previousKind)가 있으면 종류도
   * 돌려놓고, 없으면(이전 종류를 싣기 전에 영속된 줄) 지금 종류를 유지한다.
   *
   * @param updatedContent 고친 뒤 내용(결과 줄의 content)
   * @param updatedKind 고친 뒤 종류(결과 줄의 memoryKind)
   * @param previousKind 고치기 전 종류 — 없으면 null
   */
  @Transactional
  public AiMemoryItem restoreContent(
      long userId,
      long id,
      String updatedContent,
      String updatedKind,
      String previousContent,
      String previousKind) {
    Row cur = repo.lock(userId, id).orElseThrow(AiMemoryException::gone);
    boolean kindChanged = previousKind != null && !cur.kind().equals(updatedKind);
    if (!cur.content().equals(updatedContent) || kindChanged) throw AiMemoryException.changed();
    String k = previousKind == null ? cur.kind() : requireKind(previousKind);
    Row saved =
        repo.update(userId, id, k, normalizeContent(previousContent))
            .orElseThrow(AiMemoryException::gone);
    return toItem(saved, cur.content(), cur.kind());
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
   * 검증 → 사용자 잠금 → 상한 확인 → 저장(preferredId 가 있으면 그 id 를 먼저 시도). 잠금을 먼저 잡아야 동시 요청 두 건이 모두 49개를 보고 51개가
   * 되는 일을 막는다(READ COMMITTED 에서 잠금 뒤 count 는 앞 요청의 커밋을 본다).
   */
  Row insertChecked(
      long userId, String kind, String content, String source, UUID sessionId, Long preferredId) {
    String k = requireKind(kind);
    String c = normalizeContent(content);
    repo.lockUser(userId);
    if (repo.count(userId) >= LIMIT) throw AiMemoryException.full();
    // 되살리기(preferredId)는 원래 id 를 먼저 시도하고, 쓸 수 없으면 새 id 로 만든다.
    if (preferredId != null) {
      Optional<Row> same = repo.insertWithId(preferredId, userId, k, c, source, sessionId);
      if (same.isPresent()) return same.get();
    }
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

  /** 종류 검증 — PREFERENCE·CONTEXT 가 아니면 400 AI_MEMORY_INVALID. 되돌리기 복원도 같은 규칙을 쓰므로 패키지 공개. */
  static String requireKind(String kind) {
    if (kind == null || !KINDS.contains(kind)) {
      throw AiMemoryException.invalid("메모리 종류는 PREFERENCE 또는 CONTEXT 여야 해요");
    }
    return kind;
  }

  /** 저장 행 → 응답 항목(이전 값 없음 — JSON 에서 빠진다). */
  static AiMemoryItem toItem(Row r) {
    return toItem(r, null, null);
  }

  /** 저장 행 → 응답 항목. previousContent·previousKind 는 고치기 응답에만 싣는다(그 외 null — JSON 에서 빠진다). */
  static AiMemoryItem toItem(Row r, String previousContent, String previousKind) {
    return new AiMemoryItem(
        r.id(),
        r.kind(),
        r.content(),
        r.source(),
        r.createdAt(),
        r.updatedAt(),
        previousContent,
        previousKind);
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

  /**
   * 매 채팅 턴 주입할 메모리 — 꺼져 있으면 빈 목록 + enabled=false, 켜져 있으면 최신순 최대 50개(인덱스 1회). 펌프 스레드에서 불리며 테넌트는
   * TenantContextTaskDecorator 가 전파한다.
   */
  @Transactional(readOnly = true)
  public ChatMemories loadForChat(long userId) {
    if (!preferences.memoryEnabled(userId)) return ChatMemories.DISABLED;
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

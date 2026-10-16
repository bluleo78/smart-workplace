package com.workplace.home.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.HomeAttachment;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.exception.HomeSessionNotFoundException;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.HomeAttachmentRepository;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.HomeSessionRepository;
import com.workplace.user.service.AiPreferenceService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 홈 AI Chat 세션 CRUD + 메시지 영속/복원. 모든 변경은 소유권 검증. */
@Service
@RequiredArgsConstructor
public class HomeSessionService {
  private static final int TITLE_MAX = 40;

  private final HomeSessionRepository sessionRepo;
  private final HomeMessageRepository messageRepo;
  private final ObjectMapper objectMapper;
  private final HomeAttachmentRepository attachmentRepo;
  private final ExtractedTextService extractedText;

  /** WP-139: 추천을 끈 사용자에게는 저장된 후속 질문을 내려주지 않는다. */
  private final AiPreferenceService aiPreferences;

  /** WP-384: 완료 답 임베딩 요청을 커밋 뒤 이벤트로 낸다. */
  private final ApplicationEventPublisher events;

  @Transactional
  public HomeSessionResponse create(long callerId) {
    UUID id = sessionRepo.insert(callerId);
    var row = sessionRepo.findById(id).orElseThrow(() -> new HomeSessionNotFoundException(id));
    return new HomeSessionResponse(row.id(), row.title(), row.createdAt(), row.lastMessageAt());
  }

  /** 지정 id 로 세션 생성(WP-190) — 예약이 거절되면 세션을 아예 만들지 않도록 id 를 먼저 정해 둔 경로. */
  @Transactional
  public HomeSessionResponse create(long callerId, UUID id) {
    sessionRepo.insert(callerId, id);
    var row = sessionRepo.findById(id).orElseThrow(() -> new HomeSessionNotFoundException(id));
    return new HomeSessionResponse(row.id(), row.title(), row.createdAt(), row.lastMessageAt());
  }

  @Transactional(readOnly = true)
  public Page list(long callerId, String cursor, int size) {
    int limit = Math.min(100, Math.max(1, size));
    List<HomeSessionSummary> items =
        sessionRepo.listByUser(callerId, CursorCodec.decode(cursor), limit).stream()
            .map(s -> new HomeSessionSummary(s.id(), s.title(), s.lastMessageAt(), s.widgetCount()))
            .toList();
    String next =
        items.size() < limit
            ? null
            : CursorCodec.encode(
                items.get(items.size() - 1).lastMessageAt(),
                items.get(items.size() - 1).id().toString());
    return new Page(items, next);
  }

  @Transactional(readOnly = true)
  public List<HomeMessageResponse> getMessages(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    List<HomeMessageRepository.Row> rows = messageRepo.findBySession(sessionId);
    // WP-139: 추천을 끈 사용자에게는 저장된 후속 질문도 보이지 않는다. 설정 조회는 후속 질문이 저장된 행이 있을 때만 한다.
    boolean showFollowups =
        rows.stream().anyMatch(m -> m.followupsJson() != null)
            && aiPreferences.suggestionsEnabled(callerId);
    // WP-234: 세션 첨부를 한 번에 읽어 메시지별로 나눈다(N+1 회피). 순서는 findBySession 순서 유지.
    Map<Long, List<HomeAttachment>> byMessage =
        loadAttachments(sessionId).stream()
            .collect(Collectors.groupingBy(HomeAttachment::messageId));
    return rows.stream()
        .map(m -> toResponse(m, byMessage.getOrDefault(m.id(), List.of()), showFollowups))
        .toList();
  }

  /** 세션 첨부 목록(WP-234) — 소유자 검증 후 요약 경계 이전 메시지의 첨부까지 전부. */
  @Transactional(readOnly = true)
  public List<HomeAttachment> getAttachments(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    return loadAttachments(sessionId);
  }

  /** 세션 첨부 + 추출 상태(쿼리 2회). 추출 행이 없으면 NONE. */
  private List<HomeAttachment> loadAttachments(UUID sessionId) {
    List<HomeAttachment> items =
        attachmentRepo.findBySession(sessionId).stream()
            .map(
                r ->
                    new HomeAttachment(
                        r.fileId(),
                        r.messageId(),
                        r.originalName(),
                        r.mimeType(),
                        r.sizeBytes(),
                        null))
            .toList();
    return extractedText.attach(items, HomeAttachment::fileId, HomeAttachment::withExtraction);
  }

  /** 최근 대화 제목(WP-139) — 추천 생성 HTTP 는 트랜잭션 밖에서 하도록 제목만 먼저 읽는다. */
  @Transactional(readOnly = true)
  public List<String> recentTitles(long callerId, int limit) {
    return sessionRepo.recentTitles(callerId, limit);
  }

  /** 세션 누적 요약 상태(WP-232). 소유자 검증 후 반환, 요약이 없으면 (null, null). */
  @Transactional(readOnly = true)
  public HomeSessionRepository.SummaryState getContextSummary(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    return sessionRepo
        .findSummary(sessionId)
        .orElse(new HomeSessionRepository.SummaryState(null, null));
  }

  /**
   * 채팅 맥락 원천(WP-232) — 누적 요약 상태와 그 경계 이후 메시지(id·role·content)를 한 트랜잭션·한 번의 소유자 검증으로 읽는다.
   * getMessages + getContextSummary 조합은 세션 전체 메시지(JSON 컬럼 포함)를 읽고 경계 이전을 버려 낭비라 맥락 구성은 이걸 쓴다.
   */
  @Transactional(readOnly = true)
  public ContextSource getContextSource(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    HomeSessionRepository.SummaryState state =
        sessionRepo
            .findSummary(sessionId)
            .orElse(new HomeSessionRepository.SummaryState(null, null));
    List<HomeMessageRepository.ContextRow> rows =
        messageRepo.findContextAfter(sessionId, state.uptoMessageId());
    // WP-234: 원문 구간 USER 메시지의 첨부 파일명을 한 번에 읽는다(표시 [첨부: …] 용).
    List<Long> userIds =
        rows.stream()
            .filter(r -> "USER".equals(r.role()))
            .map(HomeMessageRepository.ContextRow::id)
            .toList();
    return new ContextSource(state, rows, attachmentRepo.findNamesByMessageIds(userIds));
  }

  /** 채팅 맥락 원천 — 누적 요약 상태 + 경계 이후 메시지(생성순) + 메시지별 첨부 파일명(WP-234, 없으면 키 없음). */
  public record ContextSource(
      HomeSessionRepository.SummaryState state,
      List<HomeMessageRepository.ContextRow> rows,
      Map<Long, List<String>> attachmentNames) {}

  /** 세션 누적 요약 조건부 저장(WP-232). 갱신 행 수 반환(0 = 다른 요약이 먼저 경계를 옮김). */
  @Transactional
  public int saveContextSummary(
      long callerId, UUID sessionId, Long expectedUpto, String summary, long newUpto) {
    ensureOwner(callerId, sessionId);
    return sessionRepo.updateSummary(sessionId, expectedUpto, summary, newUpto);
  }

  /**
   * 확인카드 처리 결과(#843)를 대화 이력에 남기고 저장된 메시지를 돌려준다. 다음 턴 recentContext 에 포함돼 AI 가 승인·실패·거절을 안다.
   *
   * @param role ACTION_DONE · ACTION_FAILED · ACTION_REJECTED
   */
  @Transactional
  public HomeMessageResponse appendActionResult(
      long callerId, UUID sessionId, String role, String content) {
    long id = appendMessage(callerId, sessionId, role, content, null, null, null);
    // 결과 줄은 위젯·도구단계가 없고 화면은 createdAt 을 쓰지 않으므로 재조회 없이 응답을 만든다.
    return new HomeMessageResponse(
        id, role, content, null, null, null, "COMPLETE", Instant.now(), List.of(), null, null);
  }

  /** 7b(compose)가 호출. 정상 완료(COMPLETE)로 저장한다 — 부분 답변은 status 오버로드 사용(WP-190). */
  @Transactional
  public long appendMessage(
      long callerId,
      UUID sessionId,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      String contentBlocksJson) {
    return appendMessage(
        callerId,
        sessionId,
        role,
        content,
        widgetsJson,
        toolCallsJson,
        contentBlocksJson,
        "COMPLETE");
  }

  /**
   * 메시지 영속. USER 첫 메시지면 제목 자동 설정.
   *
   * @param widgetsJson ASSISTANT 위젯 스펙(nullable)
   * @param toolCallsJson AI 도구 호출/위임 단계 JSON(ASSISTANT 전용, nullable)
   * @param contentBlocksJson 표시 블록 순서 JSON(ASSISTANT 전용, nullable — WP-158)
   * @param status 답변 종결 상태(WP-190) — COMPLETE·STOPPED·FAILED
   */
  @Transactional
  public long appendMessage(
      long callerId,
      UUID sessionId,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      String contentBlocksJson,
      String status) {
    ensureOwner(callerId, sessionId);
    long id =
        messageRepo.insert(
            sessionId, role, content, widgetsJson, toolCallsJson, contentBlocksJson, status);
    String titleIfNull = "USER".equals(role) ? trimTitle(content) : null;
    sessionRepo.touch(sessionId, titleIfNull);
    // WP-384: 완료된 답은 커밋 뒤 "질문 + 답" 임베딩을 채운다(지난 대화 의미 검색). 중단·실패·빈 답은 대상이 아니다(빈 답 = 빈 문자열만 —
    // 백필·turnText 의 `content <> ''` 와 같은 규칙). 롤백되면 이벤트도 사라진다.
    if ("ASSISTANT".equals(role)
        && "COMPLETE".equals(status)
        && content != null
        && !content.isEmpty()) {
      events.publishEvent(
          new TextEmbeddingService.Requested(
              TenantContext.get(), TextEmbeddingService.Target.TURN, id));
    }
    return id;
  }

  /**
   * USER 메시지 저장(WP-234). 본문이 비면(첨부만 보낸 메시지) 첫 첨부 파일명을 세션 제목 후보로 쓴다 — 빈 문자열이 제목으로 굳으면(coalesce) 이후
   * 텍스트 메시지로도 제목이 생기지 않기 때문.
   *
   * @param content 저장할 본문(첨부만 보낸 경우 "")
   * @param titleFallback 본문이 비었을 때 쓸 제목 후보(nullable)
   * @return 저장된 메시지 id
   */
  @Transactional
  public long appendUserMessage(
      long callerId, UUID sessionId, String content, String titleFallback) {
    ensureOwner(callerId, sessionId);
    return insertUserMessage(sessionId, content, titleFallback);
  }

  /** WP-386: 사용자 메시지에 확인된 화면 공간을 남긴다(소유자 확인). */
  @Transactional
  public void recordMessageSpace(
      long callerId, UUID sessionId, long messageId, SharedSpace.SpaceKey space) {
    ensureOwner(callerId, sessionId);
    messageRepo.setSpace(sessionId, messageId, space);
  }

  /**
   * USER 메시지 저장 — 소유 검증 생략판. 같은 요청에서 이미 ensureOwner 를 거친 호출자(HomeAttachmentService 첨부 전송)만 쓴다. 호출자
   * 트랜잭션 안에서 돈다(패키지 전용이라 외부 모듈은 부를 수 없다).
   */
  long insertUserMessage(UUID sessionId, String content, String titleFallback) {
    long id = messageRepo.insert(sessionId, "USER", content, null, null, null, "COMPLETE");
    String title = trimTitle(content);
    if (title == null && titleFallback != null) title = trimTitle(titleFallback);
    sessionRepo.touch(sessionId, title);
    return id;
  }

  /**
   * 세션 삭제. 메시지·첨부 연결은 FK CASCADE 로 지워지고, 첨부 파일 본체는 만료시각을 지금으로 당겨 FileCleanupService(1시간 주기)가 디스크·행을
   * 치우게 한다(WP-234) — 같은 트랜잭션이라 삭제가 롤백되면 만료 표시도 함께 롤백된다.
   *
   * <p>만료 표시 전에 세션 행을 잠근다 — 첨부 전송(HomeAttachmentService.appendUserMessage)은 같은 잠금을 쥔 채 파일을 붙이고 영구
   * 승격하므로, 잠금 없이 먼저 만료 표시를 하면 아직 커밋되지 않은 그 연결을 보지 못한다. 그러면 그 파일은 만료 없이 남고 연결만 CASCADE 로 지워져 영영 치워지지
   * 않는다. 잠금을 기다리는 사이 세션이 이미 지워졌으면 404.
   */
  @Transactional
  public void delete(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    if (!sessionRepo.lockForUpdate(sessionId)) throw new HomeSessionNotFoundException(sessionId);
    attachmentRepo.expireSessionFiles(sessionId);
    sessionRepo.delete(sessionId);
  }

  /** 세션 소유 검증(없음/타인 소유 모두 404). 제안 서비스가 세션 단위 조작 전에 재사용한다. */
  public void ensureOwner(long callerId, UUID sessionId) {
    var row =
        sessionRepo
            .findById(sessionId)
            .orElseThrow(() -> new HomeSessionNotFoundException(sessionId));
    if (row.userId() != callerId) throw new HomeSessionNotFoundException(sessionId);
  }

  /** 제목 후보 — 비었으면 null(제목을 정하지 않음), 길면 TITLE_MAX 자로 자른다. */
  private static String trimTitle(String content) {
    if (content == null || content.isBlank()) return null;
    String t = content.strip();
    return t.length() <= TITLE_MAX ? t : t.substring(0, TITLE_MAX);
  }

  private HomeMessageResponse toResponse(
      HomeMessageRepository.Row m, List<HomeAttachment> attachments, boolean showFollowups) {
    SplitBlocks blocks = splitMemoryBlocks(parse(m.contentBlocksJson()));
    return new HomeMessageResponse(
        m.id(),
        m.role(),
        m.content(),
        parse(m.widgetsJson()),
        parse(m.toolCallsJson()),
        blocks.display(),
        m.status(),
        m.createdAt(),
        attachments,
        showFollowups ? parseFollowups(m.followupsJson()) : null,
        blocks.memory());
  }

  /** 응답용으로 나눈 블록 — 표시 블록(contentBlocks)과 메모리 결과 줄 블록(memoryBlocks). 각각 없으면 null. */
  record SplitBlocks(JsonNode display, JsonNode memory) {}

  /**
   * WP-55: 영속 content_blocks 에서 memory 블록을 떼어 낸다(응답 DTO 전용 — 영속 형식·되돌리기 순번·라이브 경로는 그대로).
   *
   * <p>배포 중 열려 있는 구 웹은 text·tools 가 아닌 블록을 위젯으로 그리려다 memory 블록에서 깨진다. 그래서 이력 응답의 contentBlocks 에는
   * memory 블록을 싣지 않고 memoryBlocks 로 같은 순서·모양을 따로 보낸다. memory 블록만 있던 메시지(판정 5 — 표시 블록을 버린 턴)는
   * contentBlocks 를 null 로 둬 구 웹이 기존 폴백 렌더를 하게 한다(빈 배열이면 구 웹이 본문을 그리지 않는다).
   */
  static SplitBlocks splitMemoryBlocks(JsonNode blocks) {
    if (blocks == null || !blocks.isArray()) return new SplitBlocks(blocks, null);
    // 대부분의 메시지는 memory 블록이 없다 — 복사 없이 원본을 그대로 쓴다.
    if (!hasMemoryBlock(blocks)) return new SplitBlocks(blocks, null);
    ArrayNode display = JsonNodeFactory.instance.arrayNode();
    ArrayNode memory = JsonNodeFactory.instance.arrayNode();
    for (JsonNode b : blocks) {
      if (isMemoryBlock(b)) memory.add(b);
      else display.add(b);
    }
    return new SplitBlocks(display.isEmpty() ? null : display, memory);
  }

  private static boolean hasMemoryBlock(JsonNode blocks) {
    for (JsonNode b : blocks) if (isMemoryBlock(b)) return true;
    return false;
  }

  private static boolean isMemoryBlock(JsonNode b) {
    return "memory".equals(b.path("kind").asText());
  }

  /** 후속 질문 JSON → 문자열 목록. 깨진 값은 표시하지 않는다(null) — 복원 화면을 막을 만큼 중요하지 않다. */
  private List<String> parseFollowups(String json) {
    if (json == null) return null;
    try {
      return objectMapper.readValue(json, new TypeReference<List<String>>() {});
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * 후속 질문 저장(WP-139) — 소유자 검증 후 ASSISTANT 메시지에. 후속 질문 실행기 스레드에서 부르며, 그 실행기가 TenantContext 를 전파하므로 이
   * 트랜잭션이 RLS GUC 를 받는다. 갱신 행 수(0 = 반영 안 됨).
   */
  @Transactional
  @SneakyThrows
  public int saveFollowups(long callerId, UUID sessionId, long messageId, List<String> items) {
    ensureOwner(callerId, sessionId);
    // 문자열 목록 직렬화는 실패하지 않는다 — 파일의 parse 와 같이 검사 예외를 감싸지 않는다.
    return messageRepo.updateFollowups(
        sessionId, messageId, objectMapper.writeValueAsString(items));
  }

  @SneakyThrows
  private JsonNode parse(String json) {
    return json == null ? null : objectMapper.readTree(json);
  }

  public record Page(List<HomeSessionSummary> items, String nextCursor) {}
}

package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.exception.HomeSessionNotFoundException;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.HomeSessionRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
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

  @Transactional
  public HomeSessionResponse create(long callerId) {
    UUID id = sessionRepo.insert(callerId);
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
    return messageRepo.findBySession(sessionId).stream().map(this::toResponse).toList();
  }

  /** 세션 누적 요약 상태(WP-232). 소유자 검증 후 반환, 요약이 없으면 (null, null). */
  @Transactional(readOnly = true)
  public HomeSessionRepository.SummaryState getContextSummary(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    return sessionRepo
        .findSummary(sessionId)
        .orElse(new HomeSessionRepository.SummaryState(null, null));
  }

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
    return new HomeMessageResponse(id, role, content, null, null, null, Instant.now());
  }

  /**
   * 7b(compose)가 호출. USER 첫 메시지면 제목 자동 설정.
   *
   * @param widgetsJson ASSISTANT 위젯 스펙(nullable)
   * @param toolCallsJson AI 도구 호출/위임 단계 JSON(ASSISTANT 전용, nullable)
   * @param contentBlocksJson 표시 블록 순서 JSON(ASSISTANT 전용, nullable — WP-158)
   */
  @Transactional
  public long appendMessage(
      long callerId,
      UUID sessionId,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      String contentBlocksJson) {
    ensureOwner(callerId, sessionId);
    long id =
        messageRepo.insert(sessionId, role, content, widgetsJson, toolCallsJson, contentBlocksJson);
    String titleIfNull = "USER".equals(role) ? trimTitle(content) : null;
    sessionRepo.touch(sessionId, titleIfNull);
    return id;
  }

  @Transactional
  public void delete(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
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

  private static String trimTitle(String content) {
    String t = content.strip();
    return t.length() <= TITLE_MAX ? t : t.substring(0, TITLE_MAX);
  }

  private HomeMessageResponse toResponse(HomeMessageRepository.Row m) {
    return new HomeMessageResponse(
        m.id(),
        m.role(),
        m.content(),
        parse(m.widgetsJson()),
        parse(m.toolCallsJson()),
        parse(m.contentBlocksJson()),
        m.createdAt());
  }

  @SneakyThrows
  private JsonNode parse(String json) {
    return json == null ? null : objectMapper.readTree(json);
  }

  public record Page(List<HomeSessionSummary> items, String nextCursor) {}
}

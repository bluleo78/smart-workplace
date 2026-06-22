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
    return messageRepo.findBySession(sessionId).stream()
        .map(
            m ->
                new HomeMessageResponse(
                    m.id(),
                    m.role(),
                    m.content(),
                    parse(m.widgetsJson()),
                    parse(m.toolCallsJson()),
                    m.createdAt()))
        .toList();
  }

  /**
   * 7b(compose)가 호출. USER 첫 메시지면 제목 자동 설정.
   *
   * @param widgetsJson ASSISTANT 위젯 스펙(nullable)
   * @param toolCallsJson AI 도구 호출/위임 단계 JSON(ASSISTANT 전용, nullable)
   */
  @Transactional
  public long appendMessage(
      long callerId,
      UUID sessionId,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson) {
    ensureOwner(callerId, sessionId);
    long id = messageRepo.insert(sessionId, role, content, widgetsJson, toolCallsJson);
    String titleIfNull = "USER".equals(role) ? trimTitle(content) : null;
    sessionRepo.touch(sessionId, titleIfNull);
    return id;
  }

  @Transactional
  public void delete(long callerId, UUID sessionId) {
    ensureOwner(callerId, sessionId);
    sessionRepo.delete(sessionId);
  }

  private void ensureOwner(long callerId, UUID sessionId) {
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

  @SneakyThrows
  private JsonNode parse(String json) {
    return json == null ? null : objectMapper.readTree(json);
  }

  public record Page(List<HomeSessionSummary> items, String nextCursor) {}
}

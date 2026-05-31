package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.exception.HomeComposeUnavailableException;
import com.workplace.home.outbound.AiAgentComposeClient;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import com.workplace.home.outbound.ComposeMessages.ContextMessage;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 홈 컴포즈 오케스트레이션 (7b): 세션 ensure → recentContext 구성 → USER 영속 → ai-agent 호출 → ASSISTANT(위젯 포함) 영속 →
 * 응답. 소유권은 HomeSessionService 가 강제.
 */
@Service
@RequiredArgsConstructor
public class HomeComposeService {

  /** follow-up 맥락으로 전달할 직전 메시지 최대 개수(토큰 폭주 방지). */
  private static final int CONTEXT_LIMIT = 6;

  private final HomeSessionService sessionService;
  private final AiAgentComposeClient composeClient;
  private final AiAgentProperties aiAgentProperties;
  private final ObjectMapper objectMapper;

  /** sessionId null 이면 새 세션 생성. callerId 소유 세션이 아니면 getMessages/appendMessage 가 404. */
  public HomeComposeResponse compose(long callerId, UUID sessionId, String query) {
    if (!aiAgentProperties.enabled()) {
      throw new HomeComposeUnavailableException("AI 구성 기능이 현재 비활성화되어 있어요.");
    }

    UUID sid = sessionId != null ? sessionId : sessionService.create(callerId).id();

    // 현재 query 를 적재하기 전, 기존 대화에서 최근 N개를 텍스트 전용 맥락으로.
    List<ContextMessage> recentContext = buildRecentContext(callerId, sid);

    sessionService.appendMessage(callerId, sid, "USER", query, null);

    ComposeResult result = composeClient.compose(new ComposeRequest(query, recentContext));

    String widgetsJson = serializeWidgets(result.widgets());
    sessionService.appendMessage(callerId, sid, "ASSISTANT", result.message(), widgetsJson);

    return new HomeComposeResponse(sid, result.message(), result.widgets());
  }

  /** 세션의 최근 메시지를 텍스트 전용(role+content)으로, 마지막 CONTEXT_LIMIT 개만. */
  private List<ContextMessage> buildRecentContext(long callerId, UUID sessionId) {
    List<HomeMessageResponse> all = sessionService.getMessages(callerId, sessionId);
    int from = Math.max(0, all.size() - CONTEXT_LIMIT);
    return all.subList(from, all.size()).stream()
        .map(m -> new ContextMessage(m.role(), m.content()))
        .toList();
  }

  /** 위젯 JsonNode → 영속용 JSON 문자열. null/누락이면 null(USER 메시지 컨벤션과 동일). */
  private String serializeWidgets(JsonNode widgets) {
    if (widgets == null || widgets.isNull()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(widgets);
    } catch (JsonProcessingException e) {
      // 위젯 직렬화 실패는 응답 자체를 막을 만큼 치명적이지 않음 — 위젯 없이 메시지만 보존.
      return null;
    }
  }
}

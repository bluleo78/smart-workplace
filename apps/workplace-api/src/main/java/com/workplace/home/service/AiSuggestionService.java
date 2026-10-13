package com.workplace.home.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.dto.AiScreenContext;
import com.workplace.home.dto.AiSuggestionResponse;
import com.workplace.home.outbound.AiAgentSuggestionClient;
import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import com.workplace.user.service.AiPreferenceService;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 빈 대화 추천(WP-139) — 사용자 설정·비서 해석 후 ai-agent 에 동기 요청한다. 트랜잭션을 두지 않는다: 설정·제목은 각 서비스의 짧은 읽기 트랜잭션으로 먼저
 * 읽고, 최대 15초 걸리는 HTTP 는 DB 커넥션을 붙잡지 않는다.
 */
@Service
@RequiredArgsConstructor
public class AiSuggestionService {

  /** ai-agent 실행 상한 — 웹은 고정/저장 문구를 먼저 보이므로 길게 기다리지 않는다(스펙 §6). */
  static final int STARTER_TIMEOUT_MS = 15_000;

  /** 일반 추천이 참고하는 최근 대화 제목 수. */
  static final int RECENT_TITLES = 5;

  private final AiAgentProperties aiAgentProperties;
  private final AiPreferenceService preferences;
  private final AssistantResolver assistantResolver;
  private final HomeSessionService sessionService;
  private final AiAgentSuggestionClient client;

  /**
   * 화면 맞춤 추천인가 — 보고 있는 대상(focus)과 식별자(refs)가 있을 때만. 웹 starterSuggestions.isTailoredContext 와 같은 규칙.
   */
  static boolean isTailored(AiScreenContext ctx) {
    return ctx != null
        && ctx.focus() != null
        && ctx.focus().refs() != null
        && !ctx.focus().refs().isEmpty();
  }

  /** 빈 대화 추천. 꺼짐 → enabled=false, AI 비활성·비서 없음·ai-agent 실패 → 빈 목록(웹은 보이던 문구 유지). */
  public AiSuggestionResponse starter(long callerId, AiScreenContext ctx) {
    if (!preferences.suggestionsEnabled(callerId))
      return new AiSuggestionResponse(List.of(), false);
    if (!aiAgentProperties.enabled()) return new AiSuggestionResponse(List.of(), true);
    Optional<AssistantSpec> spec = assistantResolver.resolveOrEmpty(callerId);
    if (spec.isEmpty()) return new AiSuggestionResponse(List.of(), true);
    // 화면 참고가 없을 때만 최근 대화 제목을 싣는다(스펙 §4.1).
    List<String> titles = ctx == null ? sessionService.recentTitles(callerId, RECENT_TITLES) : null;
    SuggestionRequest req =
        new SuggestionRequest(
            "starter",
            spec.get().agentUserId(),
            spec.get().suggestionModel(),
            ctx,
            titles,
            null,
            null,
            isTailored(ctx) ? 3 : 4,
            STARTER_TIMEOUT_MS);
    return new AiSuggestionResponse(client.suggest(req), true);
  }
}

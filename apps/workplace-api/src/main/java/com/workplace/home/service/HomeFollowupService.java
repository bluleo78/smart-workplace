package com.workplace.home.service;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.dto.AiScreenContext;
import com.workplace.home.exception.HomeSessionNotFoundException;
import com.workplace.home.outbound.AiAgentSuggestionClient;
import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import com.workplace.user.service.AiPreferenceService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;

/**
 * 답 뒤 후속 질문(WP-139) — HomeChatTurn.complete 의 afterDone 에서 대상이면 전용 실행기에 제출하고, 실행기에서 ai-agent 로 3개를
 * 만들어 저장한 뒤 home.chat.followups 를 보낸다. 실패·시간 초과·빈 결과·그사이 추천 끔이면 아무것도 저장·발행하지 않는다.
 *
 * <p>발행은 채팅 스트림이 아니라 사용자 통합 이벤트 채널(SseRegistry.fanOut, 사용자 단위)로 나가므로 답 스트림이 이미 끝난 뒤에도 웹에 닿는다.
 */
@Slf4j
@Service
public class HomeFollowupService {

  /** ai-agent 실행 상한(스펙 §6). 클라이언트 read 25s 이내. */
  static final int FOLLOWUP_TIMEOUT_MS = 20_000;

  /** 후속 질문 수(스펙 §2.2). */
  static final int FOLLOWUP_COUNT = 3;

  /**
   * 답 앞부분만 보낸다 — 긴 답이 프롬프트를 독점하지 않게(스펙 §5.1). ai-agent(run-suggestions.ts)도 같은 4000자로 자르지만, 여기서도 잘라
   * 내부 HTTP 요청 본문 크기 자체를 묶는다(긴 답 전체를 보낸 뒤 버리지 않게). 두 값은 같게 유지한다.
   */
  static final int ANSWER_MAX_CHARS = 4_000;

  /**
   * 질문 앞부분만 보낸다 — HomeChatRequest.query 에는 길이 상한이 없는데 ai-agent zod 는 question 을 2만 자로 묶어, 넘으면 요청
   * 전체가 400 이 되어 후속 질문이 조용히 빠진다(최종 리뷰 M1). 다음 질문을 고르는 데는 앞부분이면 충분하다. ai-agent 프롬프트 빌더도 같은 값으로
   * 자른다(방어).
   */
  static final int QUESTION_MAX_CHARS = 1_000;

  /** 결정적 고정 문구 출처 — 이런 답에는 이어 물을 대상이 없다(확인 카드만 있는 답도 이 출처로 온다, 스펙 §10.9). */
  static final String SOURCE_FALLBACK = "fallback";

  private final AiPreferenceService preferences;
  private final AiAgentSuggestionClient client;
  private final HomeSessionService sessionService;
  private final AsyncTaskExecutor executor;

  public HomeFollowupService(
      AiPreferenceService preferences,
      AiAgentSuggestionClient client,
      HomeSessionService sessionService,
      @Qualifier("homeSuggestionExecutor") AsyncTaskExecutor executor) {
    this.preferences = preferences;
    this.client = client;
    this.sessionService = sessionService;
    this.executor = executor;
  }

  /**
   * 후속 질문 판단 재료 — 이번 턴 하나.
   *
   * @param messageId 저장된 ASSISTANT id(영속 실패면 null)
   * @param source ai-agent 답 출처(구 ai-agent 면 null — 대상에서 빼지 않는다)
   * @param proposed 이번 턴에 확인 카드가 나왔는가
   */
  public record FollowupInput(
      long callerId,
      UUID sessionId,
      Long messageId,
      String question,
      String answer,
      String source,
      boolean proposed,
      AiScreenContext screenContext,
      AssistantSpec spec) {}

  /** 대상 조건(스펙 §5.1): 추천 켜짐, 저장 성공, 답 텍스트 있음, fallback 아님, 확인 카드 없음. */
  static boolean eligible(FollowupInput in, boolean enabled) {
    return enabled
        && in.messageId() != null
        && in.answer() != null
        && !in.answer().isBlank()
        && !SOURCE_FALLBACK.equals(in.source())
        && !in.proposed();
  }

  /** 대상이면 실행기에 제출 — 펌프 스레드를 붙잡지 않는다. 판단·제출 실패는 삼킨다(답 완료 흐름에 영향 없음). */
  void scheduleIfEligible(HomeChatTurn turn, FollowupInput in) {
    try {
      if (!eligible(in, preferences.suggestionsEnabled(in.callerId()))) return;
      executor.execute(() -> generate(turn, in));
    } catch (TaskRejectedException e) {
      // 큐 포화 — 부가 기능이라 기다리지 않고 버린다(채팅 스트림을 절대 막지 않는다).
      log.debug("후속 질문 큐 포화 — 버림: session={}", in.sessionId());
    } catch (RuntimeException e) {
      log.warn("후속 질문 예약 실패: session={} {}", in.sessionId(), e.getMessage());
    }
  }

  /** 실행기 스레드 — 생성 → (그사이 끄지 않았으면) 저장 → 발행. */
  private void generate(HomeChatTurn turn, FollowupInput in) {
    try {
      String answer = head(in.answer(), ANSWER_MAX_CHARS);
      List<String> items =
          client.suggest(
              new SuggestionRequest(
                  "followup",
                  in.spec().agentUserId(),
                  in.spec().suggestionModel(), // 해석 완료된 요청 모델(Task 2)
                  in.screenContext(),
                  null,
                  head(in.question(), QUESTION_MAX_CHARS), // 첨부만 보낸 턴은 null
                  answer,
                  FOLLOWUP_COUNT,
                  FOLLOWUP_TIMEOUT_MS));
      if (items.isEmpty()) return;
      // 생성 중(최대 20초)에 사용자가 추천을 껐으면 저장·발행하지 않는다.
      if (!preferences.suggestionsEnabled(in.callerId())) return;
      if (sessionService.saveFollowups(in.callerId(), in.sessionId(), in.messageId(), items) == 0) {
        // 소유는 확인됐는데 갱신 0행 — 메시지가 그사이 지워졌거나 id·세션이 어긋났다. 드문 경우라 추적할 수 있게 남긴다.
        log.info("후속 질문 저장 0행 — 발행 생략: session={} message={}", in.sessionId(), in.messageId());
        return;
      }
      turn.emit("home.chat.followups", Map.of("messageId", in.messageId(), "items", items));
    } catch (HomeSessionNotFoundException e) {
      // 생성 중 대화 삭제(ensureOwner 404) — 정상 흐름이라 조용히 버린다.
      log.debug("후속 질문 저장 생략 — 대화 없음: session={}", in.sessionId());
    } catch (RuntimeException e) {
      // 그 밖의 실패(DB 오류 등)는 부가 기능이라 버리되, 원인을 볼 수 있게 경고로 남긴다.
      log.warn("후속 질문 생성·저장 실패: session={} message={}", in.sessionId(), in.messageId(), e);
    }
  }

  /**
   * 앞 max 글자(UTF-16 단위). null 은 그대로. 경계가 서로게이트 쌍 가운데면 한 글자 덜 잘라, 짝 잃은 서로게이트가 JSON 직렬화를 깨지 않게
   * 한다(이모지가 잘리는 경우).
   */
  static String head(String s, int max) {
    if (s == null || s.length() <= max) return s;
    int end = Character.isHighSurrogate(s.charAt(max - 1)) ? max - 1 : max;
    return s.substring(0, end);
  }
}

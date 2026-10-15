package com.workplace.home.outbound;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.fileai.dto.ExtractionInfo;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.home.dto.AiScreenContext;
import com.workplace.home.dto.HomeAttachment;
import java.util.List;

/** ai-agent /ai/compose 요청 계약 (7b). 응답은 SSE 스트림으로 받으므로 본 파일은 요청 본문만 정의한다. */
public final class ChatMessages {
  private ChatMessages() {}

  /**
   * compose 요청 본문. recentContext 는 follow-up 연속성용 텍스트 전용 맥락. 비서 사양은 resolver 가 해석해 적재. userId — 요청
   * 사용자 ID. ai-agent 가 MCP 도구(드라이브·캘린더 등) 컨텍스트를 assistantAgentId 아닌 실제 요청자 기준으로 실행하기 위해 전달한다(refs
   * #376). tenantId — 요청자의 active-tenant(nullable). ai-agent 가 workplace-api 대리 호출 시
   * X-On-Behalf-Of-Tenant 로 실어 보내, 다중/무 멤버십일 때 AgentTenantResolver 가 fail-closed 되는 것을 막는다(#719).
   * screenContext — 현재 화면 컨텍스트(WP-54, nullable). ai-agent 가 user 메시지 prefix 로 임베드. contextSummary —
   * 누적 요약(WP-232, nullable). sessionId·attachments — WP-234 메인 채팅 첨부. memories·memoryEnabled —
   * WP-55 사용자 메모리. app — WP-379 지금 화면 앱. today — WP-380 메모리를 고른 서버 오늘(yyyy-MM-dd, 메모리 꺼짐·조회 실패면
   * null). WP-386 sharedMemories·sharedMemoryMoreCount·currentSpace — 조직 + 지금 공간 공용 메모리와 서버가 확인한 지금
   * 공간.
   */
  public record ChatRequest(
      String query,
      List<ContextMessage> recentContext,
      long assistantAgentId,
      long userId,
      Long tenantId,
      String model,
      String thinkingDepth,
      int maxTurns,
      int timeoutMs,
      AiScreenContext screenContext,
      /** WP-232: 토큰 예산을 넘친 앞부분 대화의 누적 요약(nullable). ai-agent 가 원문 이력 앞에 싣는다. */
      String contextSummary,
      /** WP-234: 세션 id(uuid 문자열) — ai-agent 가 첨부 읽기 도구를 이 세션에 묶는다. */
      String sessionId,
      /** WP-234: 세션 전체 첨부(요약 경계 이전 메시지 포함, 매 턴 DB 에서). 없으면 빈 배열. */
      List<ChatAttachment> attachments,
      /** WP-55·WP-379: 공통 + 지금 앱 중 관련 있는 것 — 고정 먼저, 그다음 순위 순(WP-383). 꺼짐·조회 실패면 빈 배열. */
      List<AiMemoryLine> memories,
      /** WP-55: 메모리 사용 여부. false 면 ai-agent 가 "메모리 꺼짐" 한 줄만 넣어 메모리 도구를 쓰지 않게 한다. */
      boolean memoryEnabled,
      /** WP-379: 지금 화면 앱(ISSUE·WIKI·…, 없으면 null) — 블록의 "지금 화면" 안내. 주입 필터는 API 가 이미 했다. */
      String app,
      /** WP-380: 서버 오늘(Asia/Seoul, yyyy-MM-dd) — 블록의 "오늘:" 줄과 AI 의 기한 계산 근거. */
      String today,
      /** WP-383: 블록에 넣지 않은 유효 메모리 수(다른 범위 포함) — ai-agent 가 0 보다 크면 "이 밖에 메모리 N개…" 줄을 붙인다. */
      int memoryMoreCount,
      /** WP-386: 조직 + 지금 공간 공용 메모리(예산 안, 조직 → 공간 순). 메모리 꺼짐과 무관하다. */
      List<SharedMemoryLine> sharedMemories,
      /** WP-386: 예산 때문에 싣지 못한 공용 메모리 수. */
      int sharedMemoryMoreCount,
      /** WP-386: 서버가 확인한 지금 공간(없으면 null) — 공용 메모리 요청 도구의 기본 대상 안내. */
      @JsonInclude(JsonInclude.Include.NON_NULL) CurrentSpace currentSpace) {}

  /** WP-386 지금 공간 — type PROJECT·WIKI_SPACE, name 은 라벨. */
  public record CurrentSpace(String type, String name) {}

  /**
   * ai-agent 로 보내는 세션 첨부 한 건(WP-234). current = 이번 턴 USER 메시지에 붙은 파일. java.time 타입을 두지 않는다 —
   * AiAgentChatClient 가 모듈 없는 ObjectMapper 로 직렬화한다. extraction 의 비어 있는 필드는 JSON null 로 간다.
   */
  public record ChatAttachment(
      long fileId,
      long messageId,
      String originalName,
      String mimeType,
      long sizeBytes,
      boolean current,
      ExtractionInfo extraction) {

    /** 세션 첨부(HomeAttachment)에서 만든다 — current 만 호출자가 정한다(이번 턴 USER 메시지에 붙었는지). */
    public static ChatAttachment from(HomeAttachment a, boolean current) {
      return new ChatAttachment(
          a.fileId(),
          a.messageId(),
          a.originalName(),
          a.mimeType(),
          a.sizeBytes(),
          current,
          a.extraction());
    }
  }

  /** 세션 최근 메시지(텍스트만 — 위젯 jsonb 제외). */
  public record ContextMessage(String role, String content) {}

  /**
   * 누적 요약 요청(WP-232) — ai-agent /home/context-summary. previousSummary 는 직전 누적 요약(첫 요약이면 null),
   * messages 는 이번에 합칠 구간(오래된 순).
   */
  public record ContextSummaryRequest(
      long assistantAgentId,
      String model,
      int maxTurns,
      int timeoutMs,
      String previousSummary,
      List<ContextMessage> messages) {}

  /** 누적 요약 응답(WP-232). */
  public record ContextSummaryResult(String summary) {}

  /**
   * 추천 질문 요청(WP-139) — ai-agent /home/suggestions. mode: starter(빈 대화)·followup(답 뒤). model 은 비서 설정
   * 추천 모델(null = 자동). starter 는 screenContext 또는 recentTitles, followup 은 question·answer 를 싣는다.
   * null 필드는 ai-agent 가 nullish 로 받는다.
   */
  public record SuggestionRequest(
      String mode,
      long agentId,
      String model,
      AiScreenContext screenContext,
      List<String> recentTitles,
      String question,
      String answer,
      int count,
      int timeoutMs) {}

  /** 추천 질문 응답(WP-139). */
  public record SuggestionResult(List<String> items) {}
}

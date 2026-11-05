package com.workplace.chat.outbound;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.dto.IssueRecurrenceSummary;
import com.workplace.user.dto.UserKind;
import com.workplace.user.service.ServerAgentResolver;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * ChatMessageCreatedEvent → ai-agent 발사. 발사 조건:
 *
 * <ul>
 *   <li>props.enabled() == true
 *   <li>actor.kind() != "AGENT" (self-loop 차단)
 *   <li>mentions 에 서버가 실행하는(kind == "AGENT" 이면서 runtime == INTERNAL) 에이전트가 1명 이상 (WP-371)
 *   <li>그 에이전트가 이 글로 반복 회차 이어 처리를 이미 받은 AI(followUpAgentId)가 아님 (WP-1312)
 *   <li>또는 멘션으로 고른 AI 가 없을 때, 실행 일정이 걸린 작업의 담당 AI(implicitAgentId — 저장 트랜잭션이 멘션 없는 글에만 싣는다)가 서버
 *       실행·활성이고 followUpAgentId 와 다름 (WP-1377)
 * </ul>
 *
 * 다른 모든 조건은 skip — 일반 사람간 메시지나 mention 안 한 메시지(실행 일정 담당 AI 경우 제외)는 ai-agent 로 가지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatEventDispatcher {

  private final AiAgentEventClient client;
  private final AiAgentProperties props;
  private final ServerAgentResolver agentResolver;

  /** WP-386: 이슈 채팅 이벤트에 싣는 공용 메모리 리더(조직 + 이 프로젝트). */
  private final SharedAiMemoryReader sharedReader;

  // ChatSseDispatcher 와 달리 @Transactional(REQUIRES_NEW) 가 필요 없다 — 이 핸들러가 읽는 DB 는 대행 에이전트 선택 시의
  // 전역(RLS 비대상) "user" 테이블뿐이라 GUC/트랜잭션 없이도 올바르게 읽힌다(WP-386 공용 메모리는 리더가 자체 읽기 트랜잭션을 연다). 나머지는 이벤트
  // payload 만으로 outbound HTTP 발사.
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  @Async("aiAgentEventExecutor")
  public void onChatMessageCreated(ChatMessageCreatedEvent e) {
    if (!props.enabled()) return;
    if (UserKind.isAgent(e.actor().kind())) return;
    // WP-371: 서버가 실행할 (INTERNAL) 에이전트 멘션이 하나도 없으면 발사하지 않는다 — 외부 에이전트는 자기 API 키로 직접 일한다.
    // WP-417: 정지된 에이전트를 빼려면 워크스페이스가 필요하다 — aiAgentEventExecutor 의 TenantContextTaskDecorator 가 발행
    // 스레드의 테넌트를
    // 전파하므로 그 값을 명시해 넘긴다(트랜잭션 GUC 에 의존하지 않는다).
    // WP-638: 남의 개인 비서 멘션은 실행 후보에서 뺀다 — 주인 전용(주인 키로 도는 AGENT).
    // WP-1312: 반복 회차 질문의 답이라 이어 처리로 이미 깨운 AI 도 뺀다 — 같은 답에 두 번 응답하지 않게. 후보 규칙은 ChatMessageService
    // 의 반복 요약 읽기 판정과 공유한다(WP-1375).
    // WP-1377: 멘션으로 고른 AI 가 없으면 저장 쪽이 실은 실행 일정 담당 AI 가 같은 경로(INTERNAL·정지·테넌트 검사)로 답한다. 후보·대행 선택
    // 규칙은 ChatMessageService 의 반복 요약 읽기 판정과 ChatAgentWake 한 곳에서 공유한다(WP-1375).
    Long acting =
        ChatAgentWake.actingAgent(
            agentResolver,
            TenantContext.get(),
            e.actor(),
            e.mentions(),
            e.followUpAgentId(),
            e.implicitAgentId());
    if (acting == null) return;
    client.publish(new EventEnvelope("chat.message.posted", buildPayload(e, acting)));
  }

  private Map<String, Object> buildPayload(ChatMessageCreatedEvent e, Long actingAgentId) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueKey", e.issueKey());
    p.put("issueId", e.issueId());
    // #368: AI 가 이슈 컨텍스트를 인지하도록 제목·상태·본문 동봉. body 는 null 가능(CLOB).
    p.put("issueTitle", e.issueTitle());
    p.put("issueStatus", e.issueStatus());
    // WP-869: 사용자 정의 상태 이름(없으면 null) — 예전 ai-agent 는 모르는 키를 무시한다.
    p.put("issueStatusName", e.issueStatusName());
    p.put("issueBody", e.issueBody());
    p.put("threadId", e.threadId());
    p.put("messageId", e.messageId());
    p.put("actor", toMap(e.actor()));
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::toMap).toList());
    p.put("occurredAt", e.occurredAt().toString());
    p.put("actingAgentId", actingAgentId);
    // WP-386: 조직 + 이 프로젝트 공용 메모리 — 대행 에이전트가 읽을 수 있는 TEAM·OPEN 프로젝트일 때만(PERSONAL 은 조직만).
    SharedMemories shared =
        SharedMemories.orEmpty(sharedReader.readForProjectAgent(e.projectKey(), actingAgentId));
    p.put("sharedMemories", shared.items());
    p.put("sharedMemoryMoreCount", shared.moreCount());
    // WP-1375: AI 에게 맡긴 반복 업무 이슈면 그 요약 — 이슈 챗 AI 가 「다음 회차에 이 글이 전달된다」만 말하고 회차 결과를 약속하지 않게 한다.
    // 반복이 없으면 키를 뺀다(구 ai-agent 는 모르는 키를 무시한다).
    if (e.recurrence() != null) p.put("recurrence", recurrence(e.recurrence()));
    return p;
  }

  /**
   * 반복 요약(WP-1375) → 페이로드 모양 {rrule, time, enabled, agentName, nextRunAt, ownerName}.
   * rrule·agentName·nextRunAt·ownerName 은 null 일 수 있다(키는 늘 싣는다). 시각은 UTC ISO-8601(Z).
   */
  private static Map<String, Object> recurrence(IssueRecurrenceSummary r) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("rrule", r.rrule());
    m.put("time", r.time());
    m.put("enabled", r.enabled());
    m.put("agentName", r.agentName());
    m.put("nextRunAt", r.nextRunAt() == null ? null : r.nextRunAt().toString());
    m.put("ownerName", r.ownerName());
    return m;
  }

  private Map<String, Object> toMap(UserSummary u) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", u.id());
    m.put("username", u.username());
    m.put("name", u.name());
    m.put("kind", u.kind());
    return m;
  }
}

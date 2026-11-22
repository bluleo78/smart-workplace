package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MESSAGING_AGENT_RUN;

import com.workplace.messaging.dto.MessagingAgentRunAcquireRequest;
import com.workplace.messaging.dto.MessagingAgentRunAcquireResponse;
import com.workplace.messaging.dto.MessagingAgentRunReleaseRequest;
import com.workplace.messaging.dto.MessagingAgentRunReleaseResponse;
import com.workplace.messaging.repository.MessagingAgentRunRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.JSONB;
import org.jooq.Record;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 메시징 AI 대화별 실행 임대(WP-1979). ai-agent 가 여러 대여도 같은 (채널, 스레드, AI) 대화의 실행이 하나만 돌게 한다. 행 잠금(FOR UPDATE)
 * 안에서 acquire·release 규칙을 적용해, 바쁠 때 온 메시지는 최신 하나만 대기시키고 끝날 때 이어서 돌리게 한다.
 */
@Service
@RequiredArgsConstructor
public class MessagingAgentRunService {

  /** 서버가 받아들이는 임대 길이 범위(ms) — 실행 상한 15분 + 60초 ~ 1시간. */
  static final long MIN_LEASE_MS = 60_000L;

  static final long MAX_LEASE_MS = 3_600_000L;

  private final MessagingAgentRunRepository repository;
  private final ObjectMapper objectMapper;

  /**
   * 대화 실행을 시도한다. 판정 순서: ① 이미 시작했거나 대기 중인 메시지 이하면 DUPLICATE ② 소유자가 없거나 임대가 만료됐으면 ACQUIRED(보낸 토큰 또는 새
   * 토큰) ③ 그 밖에는 대기 칸을 이 메시지로 바꾸고 QUEUED.
   */
  @Transactional
  public MessagingAgentRunAcquireResponse acquire(MessagingAgentRunAcquireRequest req) {
    // 입력 검증은 행을 만들기 전에 — 거절할 요청이 아무것도 바꾸지 않게 한다.
    JsonNode event = requireEvent(req.event());
    UUID suppliedToken = parseToken(req.token());
    long parent = parentOf(req.parentMessageId());
    // 흔한 경로(행이 이미 있음)는 잠금만 하고, 행이 없을 때만 INSERT ON CONFLICT 로 만든 뒤 다시 잠근다.
    Record row = repository.lockRow(req.channelId(), parent, req.agentId());
    if (row == null) {
      repository.ensureRow(req.channelId(), parent, req.agentId());
      row = repository.lockRow(req.channelId(), parent, req.agentId());
    }
    if (row == null) {
      // 행이 보이지 않는다(다른 테넌트의 같은 키 등 RLS) — NPE 대신 명확히 실패시킨다. 5xx 가 되어 ai-agent 는 메모리 합치기로 대체한다.
      throw new IllegalStateException("임대 행을 잠글 수 없습니다 (다른 테넌트의 같은 대화 키이거나 접근 불가)");
    }
    long messageId = req.messageId();
    Long pendingId = row.get(MESSAGING_AGENT_RUN.PENDING_MESSAGE_ID);
    if (messageId <= row.get(MESSAGING_AGENT_RUN.LAST_STARTED_MESSAGE_ID)
        || (pendingId != null && messageId <= pendingId)) {
      return new MessagingAgentRunAcquireResponse(MessagingAgentRunAcquireResponse.DUPLICATE, null);
    }
    if (row.get(MessagingAgentRunRepository.LEASE_FREE)) {
      // ai-agent 가 보낸 토큰이 있으면 그것을 쓴다 — 응답을 잃어도 ai-agent 가 같은 토큰으로 반납할 수 있게(WP-1979).
      UUID token = suppliedToken != null ? suppliedToken : UUID.randomUUID();
      repository.markAcquired(
          req.channelId(), parent, req.agentId(), token, clampLease(req.leaseMs()), messageId);
      return new MessagingAgentRunAcquireResponse(
          MessagingAgentRunAcquireResponse.ACQUIRED, token.toString());
    }
    repository.setPending(
        req.channelId(), parent, req.agentId(), messageId, JSONB.valueOf(event.toString()));
    return new MessagingAgentRunAcquireResponse(MessagingAgentRunAcquireResponse.QUEUED, null);
  }

  /**
   * 임대를 반납한다. 토큰이 소유자와 다르면(만료 후 넘겨받힘 등) 아무것도 바꾸지 않고 next=null. 대기 이벤트가 있으면 그것을 이어서 돌리도록 돌려주고 임대를
   * 갱신하며, 없으면 소유와 임대를 비운다.
   */
  @Transactional
  public MessagingAgentRunReleaseResponse release(MessagingAgentRunReleaseRequest req) {
    long parent = parentOf(req.parentMessageId());
    Record row = repository.lockRow(req.channelId(), parent, req.agentId());
    // 행이 안 보이면(RLS) 반납할 것이 없다 — next=null.
    if (row == null) {
      return new MessagingAgentRunReleaseResponse(null);
    }
    UUID owner = row.get(MESSAGING_AGENT_RUN.OWNER_TOKEN);
    if (owner == null || !owner.toString().equals(req.token())) {
      return new MessagingAgentRunReleaseResponse(null);
    }
    Long pendingId = row.get(MESSAGING_AGENT_RUN.PENDING_MESSAGE_ID);
    if (pendingId != null) {
      JSONB pendingEvent = row.get(MESSAGING_AGENT_RUN.PENDING_EVENT);
      repository.promotePending(
          req.channelId(), parent, req.agentId(), pendingId, clampLease(req.leaseMs()));
      JsonNode next = pendingEvent == null ? null : objectMapper.readTree(pendingEvent.data());
      return new MessagingAgentRunReleaseResponse(next);
    }
    repository.clearOwner(req.channelId(), parent, req.agentId());
    return new MessagingAgentRunReleaseResponse(null);
  }

  /**
   * event 는 필수다 — 빠졌거나 JSON null 이면 400(IllegalArgumentException). null 을 대기로 저장하면 release 가 임대를
   * 갱신한 채 next=null 을 돌려줘 ai-agent 가 다시 반납하지 않고 멈추므로 임대가 만료까지 묶인다.
   */
  private static JsonNode requireEvent(JsonNode event) {
    if (event == null || event.isNull()) {
      throw new IllegalArgumentException("event 가 필요합니다");
    }
    return event;
  }

  /**
   * ai-agent 가 보낸 소유 토큰을 읽는다. 없으면 null(구버전 ai-agent — 서버가 만든다). UUID 가 아니면 400 으로 거절한다 — 무시하고 서버가
   * 만들면 ai-agent 는 응답을 잃었을 때 반납할 토큰을 모르는 원래 문제로 돌아가고, 거절하면 아무 행도 바뀌지 않아 묶일 임대가 생기지 않는다.
   */
  private static UUID parseToken(String token) {
    if (token == null) return null;
    try {
      return UUID.fromString(token);
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("token 은 UUID 여야 합니다");
    }
  }

  /** 스레드가 없는 인라인 멘션(null)은 0 으로 — 복합 PK 에 NULL 을 둘 수 없어서. */
  private static long parentOf(Long parentMessageId) {
    return parentMessageId == null ? 0L : parentMessageId;
  }

  /** leaseMs 를 허용 범위로 자른다 — 만료 시각 계산은 DB 시계가 한다. */
  private static long clampLease(long leaseMs) {
    return Math.max(MIN_LEASE_MS, Math.min(MAX_LEASE_MS, leaseMs));
  }
}

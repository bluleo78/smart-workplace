package com.workplace.home.service;

import com.workplace.global.realtime.SseRegistry;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 홈 채팅 이벤트 봉투(WP-190) — 사용자·대화·correlationId 좌표만 들고 home.chat.* 이벤트를 발행한다.
 *
 * <p>HomeChatTurn 에서 떼어 둔 이유(WP-139): 후속 질문은 답이 끝난 뒤 실행기 큐에서 최대 수십 초 기다렸다 발행하는데, 그동안 턴 전체(도구 단계·블록
 * 기록·영속 서비스)를 붙잡지 않고 이 좌표만 잡게 하려는 것이다. 턴의 emit 도 이 객체에 위임해 두 경로의 payload 모양이 항상 같다.
 *
 * @param correlationId 예약 시점에 발급된 턴 id — 웹이 대화별 칸으로 라우팅하는 키
 */
record HomeChatEnvelope(
    long callerId, UUID sessionId, String correlationId, SseRegistry sseRegistry) {

  /** 이벤트 발행 — 봉투 공통 필드(correlationId·sessionId)를 덧붙인다. data 는 null 값을 가질 수 있다(done 의 widgets). */
  void emit(String event, Map<String, ?> data) {
    Map<String, Object> payload = new LinkedHashMap<>(data);
    payload.put("correlationId", correlationId);
    payload.put("sessionId", sessionId.toString());
    sseRegistry.fanOut(Set.of(callerId), event, payload);
  }
}

package com.workplace.global.ai;

import java.util.List;

/**
 * AI 의 동시 진행 자리 수(WP-1205) — AI 위임 작업 「AI별」 보기의 n/3 과 work-loop 의 동시 진행 상한(WP-1040)이 같은 값을 쓰게 한다.
 * 구현은 issue 모듈(AiAgentStatusService)에 있고, member 모듈이 AI 본인 단건 조회(get_member("me"))에 싣는다 — member 가
 * issue 를 직접 import 하지 않게 뒤집은 의존이다(AiMemoryReader 와 같은 방식).
 */
public interface AgentSlotCounter {

  /**
   * 동시 진행 자리.
   *
   * @param used 지금 쓰는 자리 수(볼 수 없는 프로젝트 것도 센다)
   * @param limit 상한
   * @param issues 자리를 쥔 이슈 키(예: WP-12) — 상한에 막혔을 때 무엇이 자리를 쥐고 있는지 알리는 데 쓴다
   */
  record AgentSlots(int used, int limit, List<String> issues) {}

  /** 이 AI 가 지금 쓰는 자리 — 열린 작업이 없으면 0. */
  AgentSlots count(long agentId);
}

package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentRuntimeSlotsResponse;
import com.workplace.global.ai.AgentSlotCounter;
import com.workplace.global.ai.AgentSlotCounter.AgentSlots;
import com.workplace.user.service.WorkspaceMemberGuard;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * AI 한 명의 동시 진행 자리 조회(WP-1775). 실행 설정 서비스와 따로 둔 까닭: 자리 수 구현(issue 모듈)이 상한 규칙 때문에 설정 서비스에 기대므로, 설정
 * 서비스가 자리 수를 쓰면 생성자 순환이 된다. 이 서비스는 아무도 주입받지 않아 순환이 없다.
 */
@Service
@RequiredArgsConstructor
public class AgentRuntimeSlotService {

  private final WorkspaceMemberGuard memberGuard;
  private final AgentSlotCounter slotCounter;

  /**
   * 이 AI 의 자리 — 구성원인 AI 가 아니면 404(맡을 프로젝트 조회와 같은 가드 — 사람에게 자리가 있는 것처럼 답하지 않게). 실행 설정 행이 없어도 used
   * 0·limit 기본으로 돌려준다.
   */
  public AgentRuntimeSlotsResponse slots(long agentId) {
    memberGuard.requireAgent(agentId);
    AgentSlots s = slotCounter.count(agentId);
    return new AgentRuntimeSlotsResponse(s.used(), s.limit());
  }
}

package com.workplace.user.service;

import com.workplace.user.exception.AgentRuntimeConflictException;
import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 에이전트 실행 방식(INTERNAL|EXTERNAL)과 비서 지정 사이의 불변식을 한 곳에서 지킨다 (WP-371).
 *
 * <p>불변식: 비서(공통 비서·개인 비서)는 AI Chat 을 서버(ai-agent)가 실행해야 하므로 EXTERNAL 일 수 없다. 이를 깨는 경로는 두 개다 — "실행
 * 방식을 EXTERNAL 로 변경"(UserService.setAgentRuntime)과 "EXTERNAL 에이전트를 공통 비서로 지정"
 * (WorkspaceAssistantService.setAgent). 두 경로가 각자 검사 후 변경하면 사이에 서로 끼어들 수 있으므로, 둘 다 검사 전에 {@link
 * #lock} 으로 같은 에이전트 행을 잠가 직렬화한 뒤 이 클래스의 검사를 쓴다.
 */
@Service
@RequiredArgsConstructor
public class AgentRuntimePolicy {

  private final UserRepository userRepository;

  /**
   * 에이전트 user 행을 {@code SELECT ... FOR UPDATE} 로 잠근다. 반드시 트랜잭션 안에서 호출하며 락은 커밋/롤백까지 유지된다. 대상이 없으면
   * 0행이 잠기고 호출자의 존재 검사에서 404 로 처리된다.
   */
  public void lock(long agentId) {
    userRepository.lockForUpdate(agentId);
  }

  /** EXTERNAL 로 바꿀 수 있는지 — 어느 테넌트에서든 공통 비서이거나 개인 비서이면 409. */
  public void requireMayBeExternal(long agentId) {
    if (userRepository.isAssistantAgent(agentId)) {
      throw new AgentRuntimeConflictException(
          "공통 비서 또는 개인 비서로 쓰이는 에이전트는 외부 실행으로 바꿀 수 없습니다. 비서 지정을 먼저 해제하세요.");
    }
  }

  /** 공통 비서로 지정할 수 있는지 — EXTERNAL 에이전트면 서버가 AI Chat 을 실행하지 않으므로 409. */
  public void requireMayBeAssistant(long agentId) {
    if (userRepository.isExternalAgent(agentId)) {
      throw new AgentRuntimeConflictException("외부 실행 에이전트는 공통 비서로 지정할 수 없습니다. 먼저 실행 방식을 내부로 바꾸세요.");
    }
  }
}

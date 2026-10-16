package com.workplace.user.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 서버(ai-agent)가 대신 실행할 에이전트를 고르는 단일 규칙 (WP-371).
 *
 * <p>규칙: 후보 순서대로 보면서 kind=AGENT 이고 실행 방식이 INTERNAL 인 첫 사용자. 없으면 null — 사람만 있거나 외부(EXTERNAL) 에이전트뿐이면
 * 서버는 할 일이 없다(외부 AI 는 자기 API 키로 직접 일한다). 이슈 이벤트·이슈 채팅 멘션·메시징 응답자 선택이 모두 이 한 곳을 써서 "외부 AI 는 서버를
 * 트리거하지 않는다" 규칙이 갈라지지 않게 한다.
 *
 * <p>트랜잭션 없이 호출돼도 된다: AFTER_COMMIT @Async dispatcher 가 부르는데, 읽는 {@code "user"}·membership 은 RLS 가
 * 없는 전역 테이블이라 테넌트 GUC 가 필요 없다. WP-417: 워크스페이스에서 정지된 에이전트를 빼려면 어느 워크스페이스인지 알아야 하므로 호출측이 tenantId 를
 * 명시해 넘긴다(GUC 에 의존하지 않는다).
 */
@Service
@RequiredArgsConstructor
public class ServerAgentResolver {

  private final UserRepository userRepository;

  /**
   * 사용자 요약 목록(순서 유지) 중 서버가 실행할 첫 에이전트 id. AGENT 후보가 없으면 쿼리 없이 null — 대부분의 이벤트는 사람끼리라 추가 조회 비용을 피한다.
   */
  public Long pickActingAgent(List<UserSummary> candidates, Long tenantId) {
    return pickActingAgentId(
        candidates.stream().filter(u -> UserKind.isAgent(u.kind())).map(UserSummary::id).toList(),
        tenantId);
  }

  /**
   * AGENT 후보 id 목록(순서 유지) 중 실행 방식이 INTERNAL 인 첫 id. 호출자가 이미 kind=AGENT 로 거른 id 를 넘긴다(메시징처럼 요약 DTO 가
   * 없는 경로용). DB 가 kind·runtime 을 다시 확인하므로 사람 id 가 섞여도 뽑히지 않는다.
   *
   * @param tenantId 이벤트가 일어난 워크스페이스 — 그 워크스페이스에서 비활성(전역 비활성·멤버십 정지)인 에이전트는 뺀다(WP-417). null 이면 전역
   *     활성만 본다({@code findAssigneeInfos} 참고).
   */
  public Long pickActingAgentId(List<Long> agentCandidateIds, Long tenantId) {
    if (agentCandidateIds.isEmpty()) return null;
    Set<Long> internal =
        userRepository.findAssigneeInfos(agentCandidateIds, tenantId).stream()
            .filter(AssigneeInfo::isInternalAgent)
            // WP-417: 이 워크스페이스에서 비활성(전역 비활성·멤버십 정지)인 에이전트는 서버 실행 대상에서 뺀다.
            .filter(AssigneeInfo::isActive)
            .map(AssigneeInfo::id)
            .collect(Collectors.toSet());
    return agentCandidateIds.stream().filter(internal::contains).findFirst().orElse(null);
  }
}

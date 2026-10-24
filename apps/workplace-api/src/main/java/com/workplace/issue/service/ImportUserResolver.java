package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.repository.UserRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 이슈 가져오기(WP-883)에서 요청에 나온 username 을 사용자로 해석한다. 원작성자를 보존하는 것이 목적이라 대체 사용자(예: 가져오는 관리자)로 갈음하지 않는다 —
 * 모두 이 프로젝트의 멤버이고 이 워크스페이스에서 활성이어야 하며, 하나라도 맞지 않으면 맞지 않은 것을 전부 모아 거절한다.
 */
@Component
@RequiredArgsConstructor
public class ImportUserResolver {

  private final UserRepository userRepository;
  private final ProjectMemberRepository memberRepository;

  /**
   * @return username → 요약 맵(입력 username 전부)
   * @throws IssueImportException 멤버가 아니거나 비활성(전역 비활성·워크스페이스 정지)이거나 없는 username 이 있을 때 — 정렬된 전체 목록
   */
  public Map<String, UserSummary> resolve(long projectId, Collection<String> usernames) {
    Set<String> wanted = Set.copyOf(usernames);
    if (wanted.isEmpty()) return Map.of();

    List<AssigneeInfo> found =
        userRepository.findAssigneeInfosByUsernames(wanted, TenantContext.get());
    // 멤버 행을 공유 잠금한 채 확인한다 — 담당자 지정과 같은 이유(동시 멤버 제거와의 경합 방지).
    Set<Long> memberIds =
        memberRepository.lockMemberUserIds(
            projectId, found.stream().map(AssigneeInfo::id).collect(Collectors.toList()));

    // 활성 판정은 AssigneePolicy.requireActive 와 같은 값(isActive)을 쓴다.
    Map<String, UserSummary> resolved = new LinkedHashMap<>();
    for (AssigneeInfo u : found) {
      if (u.isActive() && memberIds.contains(u.id())) {
        resolved.put(u.username(), u.toSummary());
      }
    }
    List<String> bad = wanted.stream().filter(n -> !resolved.containsKey(n)).sorted().toList();
    if (!bad.isEmpty()) throw IssueImportException.unknownUsers(bad);
    return resolved;
  }
}

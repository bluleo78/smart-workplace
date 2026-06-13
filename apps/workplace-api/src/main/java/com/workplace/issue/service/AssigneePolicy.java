package com.workplace.issue.service;

import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.util.HashSet;
import java.util.Set;

/** 이슈 담당자로 허용되는 사용자 id 집합 계산. 개인(PERSONAL) 프로젝트는 소유자+AGENT 전체, 팀(TEAM)은 멤버. */
final class AssigneePolicy {
  private AssigneePolicy() {}

  static Set<Long> allowedAssigneeIds(
      ProjectRow project, ProjectMemberRepository memberRepo, UserRepository userRepo) {
    if ("PERSONAL".equals(project.type())) {
      Set<Long> allowed = new HashSet<>();
      allowed.add(project.ownerId());
      userRepo.findByKind(UserKind.AGENT).forEach(u -> allowed.add(u.id()));
      return allowed;
    }
    return new HashSet<>(memberRepo.findUserIdsByProject(project.id()));
  }
}

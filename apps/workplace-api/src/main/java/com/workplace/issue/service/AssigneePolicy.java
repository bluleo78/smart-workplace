package com.workplace.issue.service;

import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectMemberRepository;
import java.util.HashSet;
import java.util.Set;

/**
 * 이슈 담당자로 허용되는 사용자 id 집합 계산. 개인(PERSONAL)·팀(TEAM) 공통으로 프로젝트 멤버만 담당자로 허용한다. 개인 프로젝트에 AGENT 를 담당자로
 * 두려면 먼저 ProjectService.addMember 로 멤버 등록이 필요하다.
 */
final class AssigneePolicy {
  private AssigneePolicy() {}

  /** 허용 담당자 = 프로젝트 멤버 집합. 개인·팀 구분 없이 동일 규칙 적용. */
  static Set<Long> allowedAssigneeIds(ProjectRow project, ProjectMemberRepository memberRepo) {
    return new HashSet<>(memberRepo.findUserIdsByProject(project.id()));
  }
}

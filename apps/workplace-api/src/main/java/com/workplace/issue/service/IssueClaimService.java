package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.ClaimIssueResponse;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.IssueClaimRejectedException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.LabelSummary;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 라벨 대기열 이슈 가져가기(WP-800). 쉬고 있는 AI 구성원이 「대기열 라벨이 붙고 AI 담당자가 없는」 열린 이슈를 한 동작으로 자기 것으로 만든다 — 호출자를
 * 담당자에 <b>추가</b>(기존 사람 담당자 유지)하고 그 라벨(대소문자만 다른 같은 이름 포함)을 뗀다.
 *
 * <p>이슈 행을 먼저 잠근 한 트랜잭션 안에서 조건 판정과 두 교체를 모두 하므로, 같은 이슈를 동시에 가져가려는 두 AI 중 하나만 성공한다(진 쪽은 잠금이 풀린 뒤 라벨이
 * 이미 없거나 AI 담당자가 있는 상태를 보고 409). 담당자·라벨 교체는 기존 {@link IssueAssigneeService}·{@link
 * IssueLabelService} 를 그대로 거쳐 이력·알림·AI 작업 「시작 전」 생성이 담당자 직접 지정과 똑같이 일어난다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueClaimService {

  private final ProjectAccessGuard accessGuard;
  private final ProjectMemberRepository memberRepository;
  private final UserRepository userRepository;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final IssueLabelRepository issueLabelRepository;
  private final IssueAssigneeService assigneeService;
  private final IssueLabelService labelService;

  /**
   * 대기열 이슈를 호출자(AI)의 담당으로 가져온다.
   *
   * <p>순서: 프로젝트 멤버 확인(비멤버는 기존 권한 오류) → 호출자가 외부 실행 AI 인지 → 이슈 행 잠금 → 닫힘·라벨 유무·AI 담당 유무 판정 → 담당자 추가 →
   * 라벨 제거.
   *
   * @throws IssueClaimRejectedException 조건 불충족(409, errors.code 가 사유)
   */
  public ClaimIssueResponse claim(Long callerId, String projectKey, int number, String queueLabel) {
    var project = accessGuard.assertMember(projectKey, callerId);

    // ADMIN 은 assertMember 를 우회하지만 담당자는 구성원뿐이라, 비구성원 ADMIN 은 잠금 전에 가드와 같은 오류로 거른다.
    if (memberRepository.find(project.id(), callerId).isEmpty()) {
      throw new ProjectAccessDeniedException("프로젝트 멤버가 아닙니다");
    }

    // 외부 실행 AI 만 — 사람·내부 실행 AI 가 가져가면 이슈만 대기열을 떠나 방치된다(CLAIM_AGENT_ONLY 참조).
    if (!userRepository.isExternalAgent(callerId)) {
      throw new IssueClaimRejectedException(
          IssueClaimRejectedException.CLAIM_AGENT_ONLY, "외부 실행 AI 구성원만 이슈를 가져갈 수 있습니다");
    }

    // 이슈 행 잠금 — 판정과 변경 사이에 다른 AI 가 끼어들지 못하게 트랜잭션 끝까지 유지한다.
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    if (IssueStatuses.CLOSED.contains(issue.status())) {
      throw new IssueClaimRejectedException(
          IssueClaimRejectedException.ISSUE_CLOSED, "이미 닫힌 이슈는 가져갈 수 없습니다");
    }

    // 대기열 라벨 = 이 이슈 라벨 중 이름이 같은 것(대소문자 무시·앞뒤 공백 제거 — 목록 필터와 같은 규칙). 대소문자만 다른 것이 여럿이면 전부 뗀다.
    String name = queueLabel.trim();
    var labels = issueLabelRepository.findLabelsByIssue(issue.id());
    List<Long> queueLabelIds =
        labels.stream()
            .filter(l -> l.name().trim().equalsIgnoreCase(name))
            .map(LabelSummary::id)
            .toList();
    if (queueLabelIds.isEmpty()) {
      throw new IssueClaimRejectedException(
          IssueClaimRejectedException.NOT_IN_QUEUE, "대기열 라벨이 붙어 있지 않습니다 (이미 다른 AI 가 가져갔을 수 있습니다)");
    }

    // AI 담당자가 있으면 대기열이 아니다 — 내부·외부 실행을 가리지 않는다.
    var assignees = assigneeRepository.findByIssue(issue.id());
    if (assignees.stream().anyMatch(a -> UserKind.isAgent(a.kind()))) {
      throw new IssueClaimRejectedException(
          IssueClaimRejectedException.AI_ALREADY_ASSIGNED, "이미 다른 AI 가 가져갔습니다");
    }

    // 기존 담당자는 두고 호출자만 더한 뒤 대기열 라벨을 뺀다 — 교체 서비스가 이력·알림·AI 작업 생성을 맡는다.
    var newAssigneeIds =
        Stream.concat(assignees.stream().map(UserSummary::id), Stream.of(callerId)).toList();
    var updatedAssignees = assigneeService.replace(callerId, projectKey, number, newAssigneeIds);

    var remainingLabelIds =
        labels.stream().map(LabelSummary::id).filter(id -> !queueLabelIds.contains(id)).toList();
    var updatedLabels = labelService.replace(callerId, projectKey, number, remainingLabelIds);

    return new ClaimIssueResponse(updatedAssignees, updatedLabels);
  }
}

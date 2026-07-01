package com.workplace.project.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.project.dto.MemberRow;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 프로젝트 접근/역할 보장 가드. 컨트롤러 단의 {@code @RequirePermission} 외에 프로젝트별 멤버십/역할 체크가 필요할 때 서비스에서 호출한다. ADMIN
 * 역할은 팀(TEAM) 프로젝트 접근을 우회하지만, 개인(PERSONAL) 프로젝트는 완전 비공개라 소유자만 접근할 수 있다(ADMIN도 제외).
 */
@Service
@RequiredArgsConstructor
public class ProjectAccessGuard {

  private final ProjectRepository projectRepository;
  private final ProjectMemberRepository memberRepository;
  private final PermissionChecker permissionChecker;

  /**
   * 프로젝트가 존재하고, 호출자가 멤버(또는 ADMIN)인지 확인. 통과 시 프로젝트 row 반환.
   *
   * @throws ProjectNotFoundException 프로젝트가 없거나 soft-deleted 인 경우
   * @throws ProjectAccessDeniedException 멤버가 아닌 경우
   */
  public ProjectRow assertMember(String projectKey, Long userId) {
    return assertWithRole(projectKey, userId, null);
  }

  /**
   * 프로젝트 존재만 확인하고 row 반환 (멤버십 미검증). 멤버십 분기 전에 프로젝트를 먼저 resolve 해야 하는 경우 사용한다 (예: #418 — 이슈 담당자면
   * 비멤버여도 상세 조회 허용).
   *
   * @throws ProjectNotFoundException 프로젝트가 없거나 soft-deleted 인 경우
   */
  public ProjectRow resolve(String projectKey) {
    return projectRepository
        .findByKey(projectKey)
        .orElseThrow(() -> new ProjectNotFoundException(projectKey));
  }

  /**
   * 프로젝트 멤버십을 보장하며, requiredRole 이 지정되면 해당 역할 보유까지 검증. ADMIN 은 모든 검증을 우회.
   *
   * @param projectKey 프로젝트 key
   * @param userId 호출자 ID
   * @param requiredRole 요구 역할 (null 이면 멤버십만 검증)
   * @return 검증된 프로젝트 row
   */
  public ProjectRow assertWithRole(String projectKey, Long userId, String requiredRole) {
    ProjectRow project =
        projectRepository
            .findByKey(projectKey)
            .orElseThrow(() -> new ProjectNotFoundException(projectKey));
    boolean isPersonal = "PERSONAL".equals(project.type());
    // ADMIN 은 멤버십/역할 검증을 우회 — 단, PERSONAL 은 소유자만 접근 (완전 비공개)
    if (!isPersonal && permissionChecker.userHasRole(userId, "ADMIN")) {
      return project;
    }
    MemberRow member =
        memberRepository
            .find(project.id(), userId)
            .orElseThrow(() -> new ProjectAccessDeniedException("프로젝트 멤버가 아닙니다"));
    if (requiredRole != null && !requiredRole.equals(member.role())) {
      throw new ProjectAccessDeniedException("권한이 부족합니다: " + requiredRole + " 필요");
    }
    return project;
  }

  /**
   * 조회 가드. OPEN 은 테넌트 전원 조회 허용(RLS 가 테넌트 경계 보장) — 멤버십 불필요. TEAM 은 멤버 또는 ADMIN, PERSONAL 은 소유자만(완전
   * 비공개). 조회/목록/댓글목록/스레드 조회 등 read 진입점에서 assertMember 대신 사용한다.
   */
  public ProjectRow assertReadable(String projectKey, Long userId) {
    ProjectRow project =
        projectRepository
            .findByKey(projectKey)
            .orElseThrow(() -> new ProjectNotFoundException(projectKey));
    if ("OPEN".equals(project.type())) {
      return project; // OPEN: 테넌트 전원 허용 (RLS 가 타 테넌트 차단)
    }
    boolean isPersonal = "PERSONAL".equals(project.type());
    // 비PERSONAL 이고 ADMIN 이면 허용 (PERSONAL 은 소유자만)
    if (!isPersonal && permissionChecker.userHasRole(userId, "ADMIN")) {
      return project;
    }
    memberRepository
        .find(project.id(), userId)
        .orElseThrow(() -> new ProjectAccessDeniedException("프로젝트 멤버가 아닙니다"));
    return project;
  }

  /**
   * 이슈 생성 가드. OPEN 은 테넌트 전원 이슈 생성 허용(생성자가 reporter 로 기록됨). 그 외는 assertReadable 과 동일 규칙. 멤버십 없이 생성된
   * 이슈의 수정은 assertContentWritable 이 별도 제어.
   */
  public ProjectRow assertIssueCreatable(String projectKey, Long userId) {
    return assertReadable(projectKey, userId);
  }

  /**
   * 호출자가 프로젝트 멤버이거나 (비PERSONAL) ADMIN 인지 반환. 워크플로 필드 편집 가능 여부 판단용 헬퍼로 assertContentWritable 내부에서도
   * 사용한다.
   */
  public boolean isMemberOrAdmin(ProjectRow project, Long userId) {
    boolean isPersonal = "PERSONAL".equals(project.type());
    if (!isPersonal && permissionChecker.userHasRole(userId, "ADMIN")) {
      return true;
    }
    return memberRepository.find(project.id(), userId).isPresent();
  }

  /**
   * 호출자가 프로젝트 OWNER 멤버인지. 이슈 삭제 권한(reporter or OWNER) 판정용 헬퍼로 사용한다 — {@code softDelete} 가
   * assertWithRole(OWNER) 로 멤버 테이블의 role 을 검사하므로, 플래그도 동일하게 멤버 테이블 role 로 판정해 write 경로와 일치시킨다.
   */
  public boolean isOwner(ProjectRow project, Long userId) {
    return memberRepository
        .find(project.id(), userId)
        .map(m -> "OWNER".equals(m.role()))
        .orElse(false);
  }

  /**
   * 내용(제목/본문)·댓글 작성 가드. 멤버/ADMIN 이거나, OPEN 프로젝트에서 이슈 생성자(reporter) 본인이면 통과. 워크플로 필드 편집은 여기서 다루지
   * 않는다(호출부에서 isMemberOrAdmin 으로 별도 판정).
   */
  public void assertContentWritable(ProjectRow project, Long reporterId, Long callerId) {
    if (isMemberOrAdmin(project, callerId)) {
      return;
    }
    // OPEN 프로젝트에서 자신이 생성한 이슈(reporter == caller)는 내용 수정 허용
    if ("OPEN".equals(project.type()) && reporterId != null && reporterId.equals(callerId)) {
      return;
    }
    throw new ProjectAccessDeniedException("이 이슈를 수정할 권한이 없습니다");
  }
}

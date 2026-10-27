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
   * @throws ProjectNotFoundException 프로젝트가 없거나 soft-deleted 이거나, 볼 수 없는 프로젝트인 경우(WP-629)
   * @throws ProjectAccessDeniedException 볼 수는 있지만(OPEN) 멤버가 아닌 경우
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
    return projectRepository.findByKey(projectKey).orElseThrow(ProjectNotFoundException::hidden);
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
        projectRepository.findByKey(projectKey).orElseThrow(ProjectNotFoundException::hidden);
    // ADMIN 은 멤버십/역할 검증을 우회 — 단, PERSONAL 은 소유자만 접근 (완전 비공개)
    if (adminBypass(project, userId)) {
      return project;
    }
    MemberRow member = memberRepository.find(project.id(), userId).orElse(null);
    if (member == null) {
      // 볼 수조차 없는 프로젝트면 없는 프로젝트와 같은 404(WP-629) — 쓰기 경로가 403 이면 키를 바꿔 넣어 비공개 프로젝트의 존재를 알 수 있다.
      // 볼 수 있는 프로젝트(OPEN)의 비멤버만 403.
      if (!isReadable(project, userId)) {
        throw ProjectNotFoundException.hidden();
      }
      throw new ProjectAccessDeniedException("프로젝트 멤버가 아닙니다");
    }
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
        projectRepository.findByKey(projectKey).orElseThrow(ProjectNotFoundException::hidden);
    if (!isReadable(project, userId)) {
      // 볼 수 없는 프로젝트는 없는 프로젝트와 같은 404 로 돌려준다(WP-588) — 403 이면 비공개 프로젝트 키의 존재가 드러난다.
      throw ProjectNotFoundException.hidden();
    }
    return project;
  }

  /**
   * {@link #assertReadable} 의 boolean 판정(같은 규칙). projectId 로 찾고, 프로젝트가 없으면(삭제 포함) false. threadId 만
   * 아는 호출부(이슈 챗 스레드 경유 이슈 첨부 조회, WP-244)가 이슈 첨부 API 와 같은 조회 규칙을 쓰게 한다.
   */
  public boolean canRead(long projectId, Long userId) {
    return projectRepository.findById(projectId).map(p -> canRead(p, userId)).orElse(false);
  }

  /**
   * 출력 가림용 읽기 판정(WP-1038) — 조회자가 있으면 {@link #canRead(ProjectRow, Long)}, 없으면(null — 특정 조회자 없는 출력)
   * OPEN 만. 다른 프로젝트 부모 요약 가림(ParentRefReader)과 관계·부모 이력 가림(IssueRelationService)이 같은 규칙을 쓰게 한 곳에
   * 둔다.
   */
  public boolean canReadForViewer(ProjectRow project, Long viewerId) {
    return viewerId == null ? "OPEN".equals(project.type()) : canRead(project, viewerId);
  }

  /** {@link #canRead(long, Long)} 의 행 버전 — 이미 프로젝트 행을 가진 호출부가 같은 행을 다시 읽지 않게 한다. */
  public boolean canRead(ProjectRow project, Long userId) {
    return isReadable(project, userId);
  }

  /**
   * {@link #canRead} 와 같은 규칙이되, 멤버라서 볼 수 있는 경우 그 멤버 행을 커밋까지 공유 잠금한다(WP-776). 볼 수 있음을 근거로 워처 같은 행을
   * 남기는 쓰기가 쓴다 — 잠그지 않으면 같은 순간의 멤버 제거와 둘 다 성공해, 제거 뒤 정리(WP-476)를 피한 행이 남는다. 제거가 먼저면 false, 이쪽이 먼저면
   * 제거가 커밋을 기다렸다가 남긴 행까지 정리한다. 쓰기 트랜잭션 안에서만 부른다.
   */
  public boolean lockReadable(ProjectRow project, Long userId) {
    if ("OPEN".equals(project.type()) || adminBypass(project, userId)) {
      return true;
    }
    return memberRepository.lockMember(project.id(), userId);
  }

  /** 조회 규칙 한 곳 — OPEN 은 테넌트 전원, TEAM 은 멤버 또는 ADMIN, PERSONAL 은 멤버(소유자)만. */
  private boolean isReadable(ProjectRow project, Long userId) {
    if ("OPEN".equals(project.type())) {
      return true; // OPEN: 테넌트 전원 허용 (RLS 가 타 테넌트 차단)
    }
    // 비PERSONAL 이고 ADMIN 이면 허용 (PERSONAL 은 소유자만)
    if (adminBypass(project, userId)) {
      return true;
    }
    return memberRepository.find(project.id(), userId).isPresent();
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
    return adminBypass(project, userId) || memberRepository.find(project.id(), userId).isPresent();
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
   * 요청자의 이 프로젝트 역할 — ADMIN 우회 대상이면 "ADMIN", 아니면 멤버 role("OWNER"·"MEMBER"), 멤버가 아니면 null.
   * assertWithRole 과 같은 규칙을 역할·멤버 조회 각 1회로 내 준다 — 목록 항목마다 권한 플래그를 계산하는 곳(라벨 수정·삭제 가능 여부, WP-394)이
   * 쓴다.
   */
  public String viewerRole(ProjectRow project, Long userId) {
    if (adminBypass(project, userId)) {
      return "ADMIN";
    }
    return memberRepository.find(project.id(), userId).map(MemberRow::role).orElse(null);
  }

  /**
   * 이슈 보고자를 바꿀 수 있는지(WP-944) — 프로젝트 OWNER·ADMIN, 또는 지금 보고자 본인(넘겨주기). 보고자는 내용 쓰기·삭제 권한에 쓰여
   * (canWriteContent·softDelete) 일반 멤버에게는 열지 않는다. 바꾸기 API 와 상세 화면 플래그가 이 한 곳의 판정을 쓴다.
   */
  public boolean canChangeReporter(ProjectRow project, Long reporterId, Long callerId) {
    if (reporterId != null && reporterId.equals(callerId)) {
      return true;
    }
    String role = viewerRole(project, callerId);
    return "OWNER".equals(role) || "ADMIN".equals(role);
  }

  /** ADMIN 우회 규칙 한 곳 — 비PERSONAL 프로젝트에서 ADMIN 이면 멤버십·역할 검사를 건너뛴다(PERSONAL 은 소유자만, 완전 비공개). */
  private boolean adminBypass(ProjectRow project, Long userId) {
    return !"PERSONAL".equals(project.type()) && permissionChecker.userHasRole(userId, "ADMIN");
  }

  /**
   * 내용(제목/본문)·댓글 작성 가드. 멤버/ADMIN 이거나, OPEN 프로젝트에서 이슈 생성자(reporter) 본인이면 통과. 워크플로 필드 편집은 여기서 다루지
   * 않는다(호출부에서 isMemberOrAdmin 으로 별도 판정).
   */
  public void assertContentWritable(ProjectRow project, Long reporterId, Long callerId) {
    if (!canWriteContent(project, reporterId, callerId)) {
      // 볼 수조차 없는 프로젝트면 없는 프로젝트와 같은 404(WP-588) — 볼 수 있는데 쓸 자격만 없는 경우(OPEN 의 임의 reader)만 403.
      if (!isReadable(project, callerId)) {
        throw ProjectNotFoundException.hidden();
      }
      throw new ProjectAccessDeniedException("이 이슈를 수정할 권한이 없습니다");
    }
  }

  /**
   * {@link #assertContentWritable} 의 boolean 판정. 이슈 채팅(이슈 토크) 작성 권한도 댓글과 같은 규칙을 쓰도록(WP-213) 판정 로직을
   * 이 한 곳에 둔다 — 멤버/ADMIN 이거나, OPEN 프로젝트에서 이슈 생성자(reporter) 본인이면 true.
   */
  public boolean canWriteContent(ProjectRow project, Long reporterId, Long callerId) {
    if (isMemberOrAdmin(project, callerId)) {
      return true;
    }
    // OPEN 프로젝트에서 자신이 생성한 이슈(reporter == caller)는 내용 수정 허용
    return "OPEN".equals(project.type()) && reporterId != null && reporterId.equals(callerId);
  }

  /**
   * projectId 로 프로젝트를 찾아 {@link #canWriteContent(ProjectRow, Long, Long)} 판정. 프로젝트가 없으면(삭제 포함)
   * false.
   */
  public boolean canWriteContent(long projectId, Long reporterId, Long callerId) {
    return projectRepository
        .findById(projectId)
        .map(project -> canWriteContent(project, reporterId, callerId))
        .orElse(false);
  }
}

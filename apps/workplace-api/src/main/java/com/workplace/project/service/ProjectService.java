package com.workplace.project.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.PermissionChecker;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.MemberRow;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.dto.UpdateProjectRequest;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 도메인 서비스. 프로젝트 CRUD + 멤버십 관리. 모든 쓰기 메서드는 단일 트랜잭션 내에서 (생성/시퀀스 초기화, 역할 변경 + OWNER 보호 등) 일관성 유지.
 */
@Service
@RequiredArgsConstructor
@Transactional
public class ProjectService {

  private final ProjectRepository projectRepository;
  private final ProjectMemberRepository memberRepository;
  private final ProjectIssueSequenceRepository sequenceRepository;
  private final ProjectAccessGuard accessGuard;
  private final PermissionChecker permissionChecker;
  private final IssueTypeService issueTypeService;

  /** 프로젝트 생성. 호출자를 OWNER 로 등록 → 이슈 시퀀스 초기화 → 시스템 유형 4종(TASK/BUG/STORY/CHORE) 시드. */
  public ProjectResponse create(Long callerId, CreateProjectRequest req) {
    if (projectRepository.existsByKey(req.key())) {
      throw new ProjectConflictException("이미 사용 중인 key 입니다: " + req.key());
    }
    ProjectRow row = projectRepository.insert(req.key(), req.name(), req.description(), callerId);
    memberRepository.insert(row.id(), callerId, "OWNER");
    sequenceRepository.initialize(row.id());
    issueTypeService.seedSystemTypes(row.id());
    return ProjectResponse.from(row);
  }

  /** 사용자에게 보이는 프로젝트 목록 페이지 조회. ADMIN 은 전체, 일반 사용자는 본인 멤버 프로젝트만. */
  @Transactional(readOnly = true)
  public PageResponse<ProjectResponse> list(Long callerId, int page, int size) {
    boolean isAdmin = permissionChecker.userHasRole(callerId, "ADMIN");
    long total = projectRepository.countForUser(callerId, isAdmin);
    List<ProjectRow> rows = projectRepository.findAllForUser(callerId, isAdmin, page, size);
    int totalPages = (size == 0) ? 0 : (int) Math.ceil((double) total / size);
    return new PageResponse<>(
        rows.stream().map(ProjectResponse::from).toList(), page, size, total, totalPages);
  }

  /** 단일 프로젝트 조회. 호출자가 멤버(또는 ADMIN)여야 함. */
  @Transactional(readOnly = true)
  public ProjectResponse get(Long callerId, String projectKey) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    return ProjectResponse.from(project);
  }

  /** 프로젝트 이름/설명 수정. 메타데이터 변경은 OWNER(또는 ADMIN) 만 허용 — softDelete/멤버 관리와 일관. */
  public ProjectResponse update(Long callerId, String projectKey, UpdateProjectRequest req) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    projectRepository.update(project.id(), req.name(), req.description());
    ProjectRow updated =
        projectRepository
            .findById(project.id())
            .orElseThrow(() -> new ProjectNotFoundException(projectKey));
    return ProjectResponse.from(updated);
  }

  /** 프로젝트 soft-delete. OWNER 권한 필요. */
  public void softDelete(Long callerId, String projectKey) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    projectRepository.softDelete(project.id());
  }

  /** 프로젝트 멤버 목록 조회. 멤버 권한 필요. */
  @Transactional(readOnly = true)
  public List<MemberResponse> listMembers(Long callerId, String projectKey) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    return memberRepository.findAllByProject(project.id());
  }

  /** 멤버 추가. OWNER 권한 필요. 중복 시 409. */
  public MemberResponse addMember(Long callerId, String projectKey, AddMemberRequest req) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    if (memberRepository.isMember(project.id(), req.userId())) {
      throw new ProjectConflictException("이미 멤버입니다");
    }
    memberRepository.insert(project.id(), req.userId(), req.role());
    // username/name 채워서 응답 (단건 조회로 N+1 회피)
    return memberRepository
        .findMemberWithUser(project.id(), req.userId())
        .orElseThrow(() -> new IllegalStateException("멤버 추가 직후 조회 실패"));
  }

  /** 멤버 역할 변경. OWNER 권한 필요. 마지막 OWNER 강등 시 409. */
  public void updateMemberRole(
      Long callerId, String projectKey, Long memberUserId, UpdateMemberRoleRequest req) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    MemberRow current =
        memberRepository
            .find(project.id(), memberUserId)
            .orElseThrow(() -> new ProjectNotFoundException("멤버 없음"));
    // 현재 OWNER 가 OWNER 아닌 역할로 변경되며 다른 OWNER 가 없는 경우 차단
    if ("OWNER".equals(current.role())
        && !"OWNER".equals(req.role())
        && memberRepository.countOwners(project.id()) <= 1) {
      throw new ProjectConflictException("OWNER 가 최소 1명 이상 있어야 합니다");
    }
    memberRepository.updateRole(project.id(), memberUserId, req.role());
  }

  /** 멤버 제거. OWNER 권한 필요. 마지막 OWNER 제거 시 409. */
  public void removeMember(Long callerId, String projectKey, Long memberUserId) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    MemberRow current =
        memberRepository
            .find(project.id(), memberUserId)
            .orElseThrow(() -> new ProjectNotFoundException("멤버 없음"));
    if ("OWNER".equals(current.role()) && memberRepository.countOwners(project.id()) <= 1) {
      throw new ProjectConflictException("OWNER 가 최소 1명 이상 있어야 합니다");
    }
    memberRepository.delete(project.id(), memberUserId);
  }
}

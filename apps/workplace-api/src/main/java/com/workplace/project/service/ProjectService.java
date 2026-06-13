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
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
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
  private final PersonalProjectProvisioner provisioner;
  private final UserRepository userRepository;

  /**
   * 프로젝트 생성. typeOrDefault() 가 PERSONAL 이면 개인 프로젝트(key 자동 생성) 경로, 아니면 TEAM 경로. 호출자를 OWNER 로 등록 → 이슈
   * 시퀀스 초기화 → 시스템 유형 4종(TASK/BUG/STORY/CHORE) 시드.
   */
  public ProjectResponse create(Long callerId, CreateProjectRequest req) {
    if ("PERSONAL".equals(req.typeOrDefault())) {
      return provisioner.createPersonal(callerId, req.name(), req.description(), false);
    }
    if (req.key() == null || req.key().isBlank()) {
      throw new ProjectConflictException("팀 프로젝트는 key 가 필요합니다");
    }
    if (projectRepository.existsByKey(req.key())) {
      throw new ProjectConflictException("이미 사용 중인 key 입니다: " + req.key());
    }
    ProjectRow row =
        projectRepository.insert(req.key(), req.name(), req.description(), callerId, "TEAM", false);
    memberRepository.insert(row.id(), callerId, "OWNER");
    sequenceRepository.initialize(row.id());
    issueTypeService.seedSystemTypes(row.id());
    return ProjectResponse.from(row);
  }

  /**
   * 사용자에게 보이는 프로젝트 목록 페이지 조회. 조회 전에 기본 개인 프로젝트를 지연 프로비저닝(HUMAN 한정)한다 — provisioner 의 REQUIRES_NEW
   * 서브 트랜잭션이 먼저 커밋되므로 본 readOnly 조회가 깨끗한 커넥션에서 기본 프로젝트를 볼 수 있다. ADMIN 은 전체, 일반 사용자는 본인 멤버 프로젝트만.
   */
  @Transactional(readOnly = true)
  public PageResponse<ProjectResponse> list(Long callerId, int page, int size) {
    provisioner.ensureDefaultPersonal(callerId);
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
    // 기본 개인 프로젝트는 사용자에게 항상 1개 보장되어야 하므로 삭제 차단
    if (project.isDefault()) {
      throw new ProjectConflictException("기본 개인 프로젝트는 삭제할 수 없습니다");
    }
    projectRepository.softDelete(project.id());
  }

  /**
   * 프로젝트 멤버 목록 조회. 멤버 권한 필요. 개인 프로젝트는 멤버(OWNER 혼자) 외에 AGENT 사용자들을 담당 후보로 함께 노출한다 (멤버는 아니지만 assignee
   * 가능 — Unit 4). TEAM 프로젝트는 순수 멤버 목록 그대로 반환.
   */
  @Transactional(readOnly = true)
  public List<MemberResponse> listMembers(Long callerId, String projectKey) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    List<MemberResponse> members = memberRepository.findAllByProject(project.id());
    if (!"PERSONAL".equals(project.type())) {
      return members;
    }
    // 개인 프로젝트: 담당 후보로 AGENT 사용자도 노출 (멤버는 아니지만 assignee 가능)
    java.util.Set<Long> ids =
        members.stream().map(MemberResponse::userId).collect(java.util.stream.Collectors.toSet());
    List<MemberResponse> agents =
        userRepository.findByKind(UserKind.AGENT).stream()
            .filter(u -> !ids.contains(u.id()))
            // AGENT 후보는 합성 행(실제 project_member 아님)이라 createdAt 미사용 → null (TZ 변환 회피)
            .map(
                u ->
                    new MemberResponse(
                        u.id(), u.username(), u.name(), UserKind.AGENT, "MEMBER", null))
            .toList();
    return java.util.stream.Stream.concat(members.stream(), agents.stream()).toList();
  }

  /** 멤버 추가. OWNER 권한 필요. 중복 시 409. */
  public MemberResponse addMember(Long callerId, String projectKey, AddMemberRequest req) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    // 개인 프로젝트는 소유자 혼자만 사용 — 다른 사람 멤버 추가 차단
    if ("PERSONAL".equals(project.type())) {
      throw new ProjectConflictException("개인 프로젝트에는 멤버를 추가할 수 없습니다");
    }
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

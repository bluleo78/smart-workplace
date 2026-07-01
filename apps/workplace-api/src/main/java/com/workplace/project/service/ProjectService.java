package com.workplace.project.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.PermissionChecker;
import com.workplace.issue.repository.IssueRepository;
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
import java.util.Map;
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
  private final IssueRepository issueRepository;

  /**
   * 프로젝트 생성. typeOrDefault() 가 PERSONAL 이면 개인 프로젝트(key 자동 생성) 경로, TEAM/OPEN 이면 공유 프로젝트 경로. 공유
   * 프로젝트(TEAM·OPEN)는 key 필수·OWNER 등록·이슈 시퀀스 초기화·시스템 유형 4종(TASK/BUG/STORY/CHORE) 시드로 구조가 동일하며, 저장되는
   * type 값만 다르다. 지원하지 않는 유형(TEAM/PERSONAL/OPEN 외)은 ProjectConflictException 으로 거부.
   */
  public ProjectResponse create(Long callerId, CreateProjectRequest req) {
    if ("PERSONAL".equals(req.typeOrDefault())) {
      return provisioner.createPersonal(callerId, req.name(), req.description(), false);
    }
    // TEAM/OPEN 공통 경로 — 구조 동일, 저장되는 type 만 다르다.
    String type = req.typeOrDefault();
    if (!"TEAM".equals(type) && !"OPEN".equals(type)) {
      throw new ProjectConflictException("지원하지 않는 프로젝트 유형: " + type);
    }
    if (req.key() == null || req.key().isBlank()) {
      throw new ProjectConflictException("공유 프로젝트는 key 가 필요합니다");
    }
    if (projectRepository.existsByKey(req.key())) {
      throw new ProjectConflictException("이미 사용 중인 key 입니다: " + req.key());
    }
    ProjectRow row =
        projectRepository.insert(req.key(), req.name(), req.description(), callerId, type, false);
    memberRepository.insert(row.id(), callerId, "OWNER");
    sequenceRepository.initialize(row.id());
    issueTypeService.seedSystemTypes(row.id());
    // 생성자는 항상 OWNER — viewerIsMember=true
    return ProjectResponse.from(row, true);
  }

  /**
   * 사용자에게 보이는 프로젝트 목록 페이지 조회. 조회 전에 기본 개인 프로젝트를 지연 프로비저닝(HUMAN 한정)한다 — provisioner 의 REQUIRES_NEW
   * 서브 트랜잭션이 먼저 커밋되므로 본 readOnly 조회가 깨끗한 커넥션에서 기본 프로젝트를 볼 수 있다. ADMIN 은 전체, 일반 사용자는 본인 멤버 프로젝트만. 배치
   * 집계(N+1 회피): 상태별 이슈 수·멤버 이름·(멤버 없는 경우용) 소유자 이름을 한 쿼리씩 조회.
   */
  @Transactional(readOnly = true)
  public PageResponse<ProjectResponse> list(Long callerId, int page, int size) {
    provisioner.ensureDefaultPersonalInNewTx(callerId);
    return queryProjects(callerId, page, size);
  }

  /**
   * 프로젝트 목록 조회·집계 — 지연 프로비저닝({@link PersonalProjectProvisioner#ensureDefaultPersonal})과 분리한 순수 조회
   * 경로. 프로비저닝은 readOnly 외부 트랜잭션에서 쓰기를 위해 REQUIRES_NEW 로 커밋되므로 테스트의 롤백으로 격리되지 않는다 — 집계/RLS 동작은 이
   * 메서드를 @Transactional 테스트에서 직접 호출해 커밋 없이 검증한다.
   */
  @Transactional(readOnly = true)
  public PageResponse<ProjectResponse> queryProjects(Long callerId, int page, int size) {
    boolean isAdmin = permissionChecker.userHasRole(callerId, "ADMIN");
    long total = projectRepository.countForUser(callerId, isAdmin);
    List<ProjectRow> rows = projectRepository.findAllForUser(callerId, isAdmin, page, size);

    // 배치 집계(N+1 회피): 상태별 이슈 수 + 멤버 이름 + 소유자 이름(멤버 없는 프로젝트 폴백용)
    List<Long> projectIds = rows.stream().map(ProjectRow::id).toList();
    var statusCounts = issueRepository.countByStatusForProjects(projectIds);
    var memberNamesMap = memberRepository.findMemberNamesByProjects(projectIds);
    var ownerNames = userRepository.findNamesByIds(rows.stream().map(ProjectRow::ownerId).toList());

    List<ProjectResponse> content =
        rows.stream()
            .map(
                row -> {
                  var byStatus = statusCounts.getOrDefault(row.id(), Map.of());
                  int all = byStatus.values().stream().mapToInt(Integer::intValue).sum();
                  int canceled = byStatus.getOrDefault("CANCELED", 0);
                  int done = byStatus.getOrDefault("DONE", 0);
                  int issueTotal = all - canceled; // 취소는 진행률 분모에서 제외

                  List<String> members = memberNamesMap.getOrDefault(row.id(), List.of());
                  int memberCount;
                  List<String> topNames;
                  if (members.isEmpty()) {
                    // 멤버 행이 없으면 소유자로 폴백(개인 프로젝트 등)
                    String owner = ownerNames.get(row.ownerId());
                    topNames = owner == null ? List.of() : List.of(owner);
                    memberCount = owner == null ? 0 : 1;
                  } else {
                    memberCount = members.size();
                    topNames = members.stream().limit(3).toList();
                  }
                  // 목록은 findAllForUser 가 이미 "멤버이거나 OPEN" 행만 반환.
                  // OPEN 비멤버는 목록에는 노출되지 않으므로 여기 도달한 행은 멤버로 간주해도 무방.
                  // 단, ADMIN 은 전체를 보므로 isMemberOrAdmin 으로 정확히 계산.
                  boolean isMember = accessGuard.isMemberOrAdmin(row, callerId);
                  return ProjectResponse.from(row, issueTotal, done, memberCount, topNames, isMember);
                })
            .toList();

    int totalPages = (size == 0) ? 0 : (int) Math.ceil((double) total / size);
    return new PageResponse<>(content, page, size, total, totalPages);
  }

  /** 단일 프로젝트 조회. read 진입점 — OPEN 은 테넌트 전원, TEAM/PERSONAL 은 멤버/소유자만(assertReadable). */
  @Transactional(readOnly = true)
  public ProjectResponse get(Long callerId, String projectKey) {
    ProjectRow project = accessGuard.assertReadable(projectKey, callerId);
    // viewerIsMember: 멤버 여부를 서버에서 계산해 프론트 재파생 방지.
    boolean isMember = accessGuard.isMemberOrAdmin(project, callerId);
    return ProjectResponse.from(project, isMember);
  }

  /** 프로젝트 이름/설명 수정. 메타데이터 변경은 OWNER(또는 ADMIN) 만 허용 — softDelete/멤버 관리와 일관. */
  public ProjectResponse update(Long callerId, String projectKey, UpdateProjectRequest req) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    projectRepository.update(project.id(), req.name(), req.description());
    ProjectRow updated =
        projectRepository
            .findById(project.id())
            .orElseThrow(() -> new ProjectNotFoundException(projectKey));
    // update 는 OWNER 만 가능 — 업데이트 성공 시 항상 멤버.
    return ProjectResponse.from(updated, true);
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
   * 프로젝트 멤버 목록 조회. 멤버 권한 필요. 실제 project_member 행만 반환 — 합성 AGENT 주입 없음. 개인 프로젝트에 AGENT 를 담당자로 쓰려면
   * addMember 로 실제 멤버 등록 후 issueService 에서 담당 지정한다 (#418 정책 통일).
   */
  @Transactional(readOnly = true)
  public List<MemberResponse> listMembers(Long callerId, String projectKey) {
    // read 진입점(담당자 picker·멤버 표시) — OPEN 은 테넌트 전원 허용(assertReadable).
    ProjectRow project = accessGuard.assertReadable(projectKey, callerId);
    return memberRepository.findAllByProject(project.id());
  }

  /**
   * 멤버 추가. OWNER 권한 필요. 중복 시 409. 개인 프로젝트는 비공개 유지(HUMAN 멤버 불가), AGENT 는 담당자로 쓸 수 있도록 멤버 추가 허용
   * (#418).
   */
  public MemberResponse addMember(Long callerId, String projectKey, AddMemberRequest req) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    // 개인 프로젝트: AGENT 만 멤버로 추가 허용 (담당자 지정용). HUMAN 은 비공개 유지 정책으로 차단.
    // AGENT 는 요청 role 과 무관하게 항상 MEMBER 로 강제 — 개인 프로젝트 OWNER 는 사람만.
    String roleToInsert = req.role();
    if ("PERSONAL".equals(project.type())) {
      var added =
          userRepository
              .findById(req.userId())
              .orElseThrow(() -> new IllegalArgumentException("사용자 없음: " + req.userId()));
      if (!UserKind.isAgent(added.kind())) {
        throw new ProjectConflictException("개인 프로젝트에는 사람 멤버를 추가할 수 없습니다");
      }
      // 개인 프로젝트의 AGENT 는 MEMBER 고정 — OWNER 역할 요청이 들어와도 무시한다.
      roleToInsert = "MEMBER";
    }
    if (memberRepository.isMember(project.id(), req.userId())) {
      throw new ProjectConflictException("이미 멤버입니다");
    }
    memberRepository.insert(project.id(), req.userId(), roleToInsert);
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

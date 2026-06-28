package com.workplace.user.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.repository.RoleRepository;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.CreateMemberRequest;
import com.workplace.user.dto.MemberResponse;
import com.workplace.user.dto.RenameAgentRequest;
import com.workplace.user.dto.UserDetailResponse;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.PersonalAssistantRenameForbiddenException;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserService {

  private final UserRepository userRepository;
  private final RoleRepository roleRepository;
  private final PasswordEncoder passwordEncoder;
  private final AuditLogService auditLogService;
  private final MembershipRepository membershipRepository;

  @Transactional(readOnly = true)
  public PageResponse<UserResponse> getUsers(String search, int page, int size) {
    Long tenantId = requireTenant();
    List<UserResponse> content = userRepository.findAllPaginated(tenantId, search, page, size);
    long totalElements = userRepository.countByTenant(tenantId, search);
    int totalPages = (int) Math.ceil((double) totalElements / size);
    return new PageResponse<>(content, page, size, totalElements, totalPages);
  }

  /**
   * 사용자 목록 계열 조회의 active 테넌트를 확정한다. user 는 전역 테이블이라 RLS 로 자동 격리되지 않으므로, 인증된 요청의 테넌트 컨텍스트를 명시적으로 읽어
   * 멤버만 노출한다(다른 테넌트 사용자 누출 방지). 인증된 ADMIN 경로라 컨텍스트가 반드시 있어야 한다.
   */
  private Long requireTenant() {
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      throw new IllegalStateException("사용자 목록 조회에는 active 테넌트 컨텍스트가 필요합니다.");
    }
    return tenantId;
  }

  @Transactional(readOnly = true)
  public UserDetailResponse getUserById(Long id) {
    UserResponse user =
        userRepository
            .findById(id)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + id));
    List<RoleResponse> roles = roleRepository.findByUserId(id);
    return new UserDetailResponse(
        user.id(),
        user.username(),
        user.email(),
        user.name(),
        user.isActive(),
        user.createdAt(),
        roles,
        user.kind());
  }

  /** Phase 5a — kind 별 사용자 목록 (AGENT 관리 화면 등). active 테넌트 멤버로 스코프된다. */
  @Transactional(readOnly = true)
  public List<UserResponse> listByKind(String kind) {
    return userRepository.findByKind(requireTenant(), kind);
  }

  /**
   * AGENT 목록 — 워크스페이스 에이전트 관리용. includePersonal=false(기본)면 개인 비서(자동 생성 AGENT)를 제외한다. 개인 비서는 사용자별
   * 비공개라 기본 목록에서 숨기고, 토글로만 포함한다.
   */
  @Transactional(readOnly = true)
  public List<com.workplace.user.dto.AgentResponse> listAgents(boolean includePersonal) {
    return userRepository.findAgents(requireTenant(), includePersonal);
  }

  /** 감사 로그용 username 조회 — caller 사용자가 없는 테스트 환경에서는 "system" 으로 대체. */
  private String resolveUsername(Long callerId) {
    if (callerId == null) return "system";
    return userRepository.findById(callerId).map(UserResponse::username).orElse("system");
  }

  /**
   * Phase 5a — AGENT 유저 생성. ADMIN 권한은 컨트롤러의 @RequirePermission 으로 가드한다. password=NULL, kind='AGENT'
   * 로 저장되며 별도 역할은 부여하지 않는다(필요 시 ADMIN 이 부여).
   */
  @Transactional
  public UserResponse createAgent(Long callerId, CreateAgentRequest req) {
    if (userRepository.existsByUsername(req.username())) {
      throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
    }
    if (userRepository.existsByEmail(req.email())) {
      throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }
    UserResponse created = userRepository.createAgent(req.username(), req.email(), req.name());
    // 에이전트를 현재 active 테넌트에 귀속 — 콜백 시 단일-멤버십으로 RLS 컨텍스트가 해석되도록.
    // 인증된 ADMIN 경로이므로 active 테넌트가 반드시 있어야 한다(테넌트 없는 고아 에이전트 방지).
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      throw new IllegalStateException("에이전트 생성에는 active 테넌트 컨텍스트가 필요합니다.");
    }
    membershipRepository.create(created.id(), tenantId, "ACTIVE");
    String callerUsername = resolveUsername(callerId);
    // 감사 로그 — AGENT_CREATED (action_type, resource=user, resource_id=신규 user id)
    auditLogService.log(
        callerId,
        callerUsername,
        "AGENT_CREATED",
        "user",
        String.valueOf(created.id()),
        "AGENT 유저 생성: " + created.username(),
        null,
        null,
        "SUCCESS",
        null,
        java.util.Map.of("username", created.username(), "name", created.name()));
    return created;
  }

  /**
   * 테넌트 관리자가 새 구성원을 추가한다(고객 콘솔 셀프서비스).
   *
   * <p>계정 생성 + 멤버십(MEMBER) + RBAC 역할(관리자=ADMIN/일반=USER)을 단일 트랜잭션으로 처리한다. 멤버십 직위는 항상 MEMBER — 워크스페이스
   * OWNER 는 셀프서비스로 부여하지 않는다. RBAC 역할 부여(user_role insert)는 현재 테넌트 GUC 하에서 일어난다(RLS). 계정 생성 + 역할 부여는
   * 민감 작업이라 createAgent 와 동일하게 감사 로그를 남긴다.
   */
  @Transactional
  public MemberResponse createMember(CreateMemberRequest req, Long callerId) {
    // 아이디(로그인 ID) 중복 → 409
    if (userRepository.existsByUsername(req.username())) {
      throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
    }
    // 이메일은 선택값. 공백/널이면 null 로 저장하고, 값이 있으면 중복 검사.
    String email = (req.email() == null || req.email().isBlank()) ? null : req.email();
    if (email != null && userRepository.existsByEmail(email)) {
      throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }
    // 인증된 ADMIN 경로이므로 active 테넌트가 반드시 있어야 한다(테넌트 없는 고아 계정 방지) — createAgent 동일 가드.
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      throw new IllegalStateException("구성원 추가에는 active 테넌트 컨텍스트가 필요합니다.");
    }
    // 계정 생성 — 로그인이 검증하는 동일 인코더로. is_active 는 DB DEFAULT TRUE(즉시 로그인 가능).
    String encoded = passwordEncoder.encode(req.password());
    UserResponse user = userRepository.save(req.username(), email, encoded, req.name());

    // 멤버십 직위는 항상 MEMBER.
    membershipRepository.createWithRole(user.id(), tenantId, "ACTIVE", "MEMBER");

    // RBAC 역할 부여 — 현재 테넌트 GUC 하 user_role insert.
    Long roleId =
        roleRepository
            .findByName(req.role())
            .orElseThrow(() -> new IllegalStateException("역할이 없습니다: " + req.role()))
            .id();
    userRepository.setRoles(user.id(), List.of(roleId));

    // 감사 로그 — MEMBER_CREATED (createAgent 의 AGENT_CREATED 와 동형).
    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "MEMBER_CREATED",
        "user",
        String.valueOf(user.id()),
        "구성원 계정 생성: " + user.username() + " (역할 " + req.role() + ")",
        null,
        null,
        "SUCCESS",
        null,
        java.util.Map.of("username", user.username(), "role", req.role()));

    return new MemberResponse(
        user.id(), user.username(), user.name(), user.email(), req.role(), "ACTIVE");
  }

  /**
   * Phase 5a — AGENT 유저 삭제. agent_api_key 는 ON DELETE CASCADE 로 함께 제거된다. ADMIN 가드는 컨트롤러에서 처리. 안전상
   * AGENT 만 삭제 허용.
   */
  @Transactional
  public void deleteAgent(Long callerId, Long userId) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));
    if (!UserKind.isAgent(user.kind())) {
      throw new IllegalArgumentException("AGENT 유저만 삭제할 수 있습니다");
    }
    String callerUsername = resolveUsername(callerId);
    userRepository.deleteById(userId);
    auditLogService.log(
        callerId,
        callerUsername,
        "AGENT_DELETED",
        "user",
        String.valueOf(userId),
        "AGENT 유저 삭제: " + user.username(),
        null,
        null,
        "SUCCESS",
        null,
        null);
  }

  /**
   * Phase 5a — ADMIN 의 AGENT 이름/식별자 변경. 공통 비서·일반 AGENT 만 대상이며, 개인 비서는 거부(403)한다(소유자만 프로필에서 변경).
   * email 은 변경하지 않는다.
   *
   * <p>가드 순서: 존재 → AGENT 종류 → 개인 비서 거부 → 예약 접두어(__assistant_u) 차단 → username 중복(자신 제외).
   */
  @Transactional
  public void renameAgent(Long callerId, Long userId, RenameAgentRequest req) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));
    if (!UserKind.isAgent(user.kind())) {
      throw new IllegalArgumentException("AGENT 유저만 이름을 변경할 수 있습니다");
    }
    // 개인 비서는 관리자가 변경 불가 — 소유자가 자신의 프로필(/settings/assistant)에서만 변경.
    if (AgentUsernames.isPersonalAssistant(user.username())) {
      throw new PersonalAssistantRenameForbiddenException(
          "개인 비서는 관리자가 변경할 수 없습니다. 소유자가 프로필에서 변경할 수 있어요.");
    }
    // 예약 접두어로 username 을 바꾸면 목록에서 사라지고(개인 비서로 오인) 이후 rename 도 막히므로 차단.
    if (AgentUsernames.isPersonalAssistant(req.username())) {
      throw new IllegalArgumentException("사용할 수 없는 아이디입니다.");
    }
    // username 변경 시에만 중복 검사(자신 제외) — 이름만 바꾸는 경우 통과.
    if (!req.username().equals(user.username())
        && userRepository.existsByUsernameExcludingUser(req.username(), userId)) {
      throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
    }
    userRepository.renameAgentIdentity(userId, req.username(), req.name());
    // 감사 로그 — AGENT_RENAMED (이전/이후 username·name 메타).
    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_RENAMED",
        "user",
        String.valueOf(userId),
        "AGENT 유저 변경: " + user.username() + " → " + req.username(),
        null,
        null,
        "SUCCESS",
        null,
        java.util.Map.of(
            "oldUsername", user.username(),
            "newUsername", req.username(),
            "oldName", user.name(),
            "newName", req.name()));
  }

  @Transactional
  public void updateProfile(Long userId, String name, String email) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));

    if (email != null && !email.equals(user.email())) {
      if (userRepository.existsByEmailExcludingUser(email, userId)) {
        throw new EmailAlreadyExistsException("Email already exists: " + email);
      }
    }

    userRepository.update(userId, name, email);
  }

  @Transactional
  public void changePassword(Long userId, String currentPassword, String newPassword) {
    String storedPassword =
        userRepository
            .findPasswordById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));

    // 현재 비밀번호 불일치 시 400 Bad Request로 명확한 한국어 메시지 반환 (#27)
    if (!passwordEncoder.matches(currentPassword, storedPassword)) {
      throw new IllegalArgumentException("현재 비밀번호가 올바르지 않습니다");
    }

    userRepository.updatePassword(userId, passwordEncoder.encode(newPassword));
  }

  @Transactional
  public void setUserRoles(Long userId, List<Long> roleIds, Long callerId) {
    if (!userRepository.existsById(userId)) {
      throw new UserNotFoundException("User not found: " + userId);
    }
    // 자기 자신의 ADMIN 역할 제거 차단 — 자기 잠금(self-lockout) 방지 (#57)
    if (userId.equals(callerId)) {
      roleRepository
          .findByName("ADMIN")
          .ifPresent(
              adminRole -> {
                List<RoleResponse> currentRoles = roleRepository.findByUserId(userId);
                boolean hasAdminNow =
                    currentRoles.stream().anyMatch(r -> r.id().equals(adminRole.id()));
                boolean wouldRemoveAdmin = roleIds == null || !roleIds.contains(adminRole.id());
                if (hasAdminNow && wouldRemoveAdmin) {
                  throw new IllegalArgumentException("자신의 ADMIN 역할은 제거할 수 없습니다");
                }
              });
    }
    userRepository.setRoles(userId, roleIds);
  }

  @Transactional
  public void setUserActive(Long userId, boolean active) {
    if (!userRepository.existsById(userId)) {
      throw new UserNotFoundException("User not found: " + userId);
    }
    // 마지막 활성 ADMIN 비활성화 방지 — 모든 ADMIN이 잠기면 시스템 관리 불가 (#146)
    if (!active && userRepository.hasAdminRole(userId) && userRepository.countActiveAdmins() <= 1) {
      throw new IllegalStateException("마지막 활성 ADMIN 계정은 비활성화할 수 없습니다");
    }
    userRepository.setActive(userId, active);
  }
}

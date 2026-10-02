package com.workplace.user.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.tenant.TenantContext;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.repository.RoleRepository;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.tenant.repository.TenantRepository;
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
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
  // WP-48: SSO 전용 구성원 등록 시 워크스페이스 SSO 켜짐 여부 확인
  private final TenantRepository tenantRepository;
  // AI 가용성 해석 — 개인/공통 비서 중 active token 보유 여부를 판단. /users/me 응답에 aiAvailable 노출.
  private final AssistantResolver assistantResolver;

  /** kind 미지정 호출부(설정 > 사용자 관리 등 기존 호출) — HUMAN 만 노출하는 기존 동작 유지. */
  @Transactional(readOnly = true)
  public PageResponse<UserResponse> getUsers(String search, int page, int size) {
    return getUsers(search, page, size, UserKind.HUMAN);
  }

  /**
   * kind 필터를 명시하는 사용자 목록 조회. DM/멘션 등 에이전트를 포함해야 하는 검색은 {@link UserKind#AGENT} 또는 {@link
   * UserKind#ALL_FILTER} 를 넘긴다.
   */
  @Transactional(readOnly = true)
  public PageResponse<UserResponse> getUsers(String search, int page, int size, String kind) {
    Long tenantId = requireTenant();
    List<UserResponse> content =
        userRepository.findAllPaginated(tenantId, search, page, size, kind);
    long totalElements = userRepository.countByTenant(tenantId, search, kind);
    int totalPages = (int) Math.ceil((double) totalElements / size);
    return new PageResponse<>(content, page, size, totalElements, totalPages);
  }

  /**
   * 사용자 목록 계열 조회의 active 테넌트를 확정한다. user 는 전역 테이블이라 RLS 로 자동 격리되지 않으므로, 인증된 요청의 테넌트 컨텍스트를 명시적으로 읽어
   * 멤버만 노출한다(다른 테넌트 사용자 누출 방지). 인증된 ADMIN 경로라 컨텍스트가 반드시 있어야 한다.
   */
  private Long requireTenant() {
    return TenantContext.require();
  }

  /**
   * 단건 조회/변경계 API(getUserById/setUserRoles/setUserActive) 공통 가드 (#811). user 는 전역 테이블이라 id 만으로는 다른
   * 테넌트 사용자에도 접근 가능하므로, 대상이 현재 active 테넌트의 ACTIVE 멤버인지 명시 검증한다. 비멤버는 존재 자체를 노출하지 않도록 404(Not
   * Found)로 응답한다 — project 도메인의 멤버십 가드와 동일 패턴.
   */
  private void requireMember(Long userId) {
    Long tenantId = requireTenant();
    if (!membershipRepository.hasActiveMembership(userId, tenantId)) {
      throw UserNotFoundException.ofId(userId);
    }
  }

  /**
   * ADMIN 등 타인 조회용(`GET /{id}`) — 대상이 현재 active 테넌트 멤버인지 검증한다 (#811). 비멤버 조회는 404 로 응답해 존재 자체를 숨긴다.
   */
  @Transactional(readOnly = true)
  public UserDetailResponse getUserById(Long id) {
    requireMember(id);
    return loadUserDetail(id);
  }

  /**
   * 본인 프로필 조회용(`GET /me`) — 인증된 principal 이 곧 대상이므로 멤버십 검증이 필요 없다(자기 자신 조회는 항상 허용). AGENT 가 API 키로
   * 인증했지만 아직 어떤 테넌트에도 활성 멤버십이 없어 active 테넌트 컨텍스트가 없는 경우에도(#811 이전부터의 기존 동작) 자기 신원 조회는 막지 않는다.
   */
  @Transactional(readOnly = true)
  public UserDetailResponse getMyProfile(Long userId) {
    return loadUserDetail(userId);
  }

  private UserDetailResponse loadUserDetail(Long id) {
    UserResponse user =
        userRepository.findById(id).orElseThrow(() -> UserNotFoundException.ofId(id));
    List<RoleResponse> roles = roleRepository.findByUserId(id);
    // AI 가용성 — 개인 또는 공통 비서(active token) 보유 여부. 프론트가 AI affordance 게이트에 사용.
    boolean aiAvailable = assistantResolver.resolveOrEmpty(id).isPresent();
    return new UserDetailResponse(
        user.id(),
        user.username(),
        user.email(),
        user.name(),
        user.isActive(),
        user.createdAt(),
        roles,
        user.kind(),
        aiAvailable,
        userRepository.hasPassword(id));
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
    // 인증된 ADMIN 경로이므로 active 테넌트가 반드시 있어야 한다(테넌트 없는 고아 계정 방지) — createAgent 동일 가드.
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      throw new IllegalStateException("구성원 추가에는 active 테넌트 컨텍스트가 필요합니다.");
    }
    // 아이디 이메일 형식은 CreateMemberRequest 가 검증한다(WP-181).
    String username = req.username().trim();
    // WP-48: 비밀번호를 비우면 SSO 전용 구성원. 워크스페이스 SSO 가 켜져 있어야 한다(아니면 로그인 불가 계정이 생김).
    boolean ssoOnly = req.password() == null || req.password().isBlank();
    if (ssoOnly) {
      if (!tenantRepository.isSsoEnabled(tenantId)) {
        throw new IllegalStateException("SSO 로그인이 꺼져 있어 비밀번호 없이 구성원을 추가할 수 없습니다.");
      }
      // SSO 전용만 소문자 정규화 — 비밀번호 로그인은 아이디 정확 일치라 비밀번호 구성원은 입력값 그대로 둔다.
      username = username.toLowerCase(Locale.ROOT);
    }
    // 아이디(로그인 ID) 중복 → 409. WP-48: SSO 매칭이 대소문자 무시이므로 두 경로 모두 대소문자 무시로 검사한다
    // (대소문자만 다른 계정이 생기면 SSO 매칭이 모호해져 거부된다).
    if (!userRepository.findIdsByUsernameIgnoreCase(username).isEmpty()) {
      throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
    }
    // 이메일은 선택값. 공백/널이면 null 로 저장하고, 값이 있으면 중복 검사.
    String email = (req.email() == null || req.email().isBlank()) ? null : req.email();
    if (email != null && userRepository.existsByEmail(email)) {
      throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }
    // 계정 생성 — 로그인이 검증하는 동일 인코더로. SSO 전용은 password=NULL(비밀번호 로그인 불가).
    String encoded = ssoOnly ? null : passwordEncoder.encode(req.password());
    UserResponse user = userRepository.save(username, email, encoded, req.name());

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
        Map.of(
            "username",
            user.username(),
            "role",
            req.role(),
            "loginMethod",
            ssoOnly ? "SSO" : "PASSWORD"));

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
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));
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
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));
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
    // 설명 문구엔 실제로 바뀐 필드만 반영한다 — username 이 그대로인 채 name 만 바뀌면
    // "username → 동일 username" 만 찍혀 변경이 없었던 것처럼 보이는 오해를 방지(#796).
    StringBuilder renameDesc = new StringBuilder("AGENT 유저 변경: ");
    boolean usernameChanged = !user.username().equals(req.username());
    boolean nameChanged = !user.name().equals(req.name());
    if (usernameChanged) {
      renameDesc.append("아이디 ").append(user.username()).append(" → ").append(req.username());
    }
    if (nameChanged) {
      if (usernameChanged) {
        renameDesc.append(", ");
      }
      renameDesc.append("이름 ").append(user.name()).append(" → ").append(req.name());
    }
    if (!usernameChanged && !nameChanged) {
      renameDesc.append("변경 없음");
    }
    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_RENAMED",
        "user",
        String.valueOf(userId),
        renameDesc.toString(),
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
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));

    if (email != null && !email.equals(user.email())) {
      if (userRepository.existsByEmailExcludingUser(email, userId)) {
        throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다 (email: " + email + ")");
      }
    }

    userRepository.update(userId, name, email);
  }

  @Transactional
  public void changePassword(
      Long userId, String currentPassword, String newPassword, String authMethod) {
    if (!userRepository.existsById(userId)) throw UserNotFoundException.ofId(userId);
    Optional<String> storedPassword = userRepository.findPasswordById(userId);

    // WP-48: 비밀번호 없는(SSO 전용) 계정의 최초 설정 — 현재 비밀번호 대신 "지금 SSO 로 로그인한 세션"이 본인 확인이다.
    // PAT(swp_)·Internal 인증은 amr 이 없으므로 거부 — 유출된 PAT 가 영구 비밀번호 로그인으로 바뀌는 경로를 막는다.
    if (storedPassword.isEmpty()) {
      if (!AuthDetails.SSO.equals(authMethod)) {
        throw new IllegalArgumentException("SSO 로 로그인한 상태에서만 비밀번호를 설정할 수 있습니다");
      }
      userRepository.updatePassword(userId, passwordEncoder.encode(newPassword));
      auditLogService.log(
          userId,
          resolveUsername(userId),
          "PASSWORD_SET",
          "user",
          String.valueOf(userId),
          "SSO 전용 계정 비밀번호 설정",
          null,
          null,
          "SUCCESS",
          null,
          null);
      return;
    }
    // 현재 비밀번호 불일치 시 400 Bad Request로 명확한 한국어 메시지 반환 (#27)
    if (currentPassword == null
        || !passwordEncoder.matches(currentPassword, storedPassword.get())) {
      throw new IllegalArgumentException("현재 비밀번호가 올바르지 않습니다");
    }
    userRepository.updatePassword(userId, passwordEncoder.encode(newPassword));
  }

  @Transactional
  public void setUserRoles(Long userId, List<Long> roleIds, Long callerId) {
    checkSetRoles(userId, roleIds, callerId);
    userRepository.setRoles(userId, roleIds);
  }

  /** 역할 교체 술어 본체(쓰기 없음) — 존재·테넌트 멤버십·자기 잠금 방지. 실행/사전검증 양쪽이 공유한다 (#842). */
  private void checkSetRoles(Long userId, List<Long> roleIds, Long callerId) {
    if (!userRepository.existsById(userId)) {
      throw UserNotFoundException.ofId(userId);
    }
    // 대상이 현재 테넌트 멤버가 아니면 타 테넌트 사용자의 전역 역할을 바꿀 수 없다 (#811).
    requireMember(userId);
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
  }

  /**
   * 역할명(ADMIN/USER)으로 역할을 교체한다 (#833). AI 확인 카드 경로용 — 에이전트는 roleId 를 알 수 없고, 역할 목록 조회에는 role:read 가
   * 필요해 에이전트에 권한을 더 주게 된다. 이름→id 해석을 서버(=사람 권한으로 실행되는 실행기)에서 수행해 에이전트 권한을 조회 전용으로 유지한다.
   */
  @Transactional
  public void setUserRolesByNames(Long userId, List<String> roleNames, Long callerId) {
    List<Long> roleIds = resolveRolesByNames(userId, roleNames, callerId);
    userRepository.setRoles(userId, roleIds);
  }

  /**
   * 역할명 기반 역할 교체의 사전검증(dry-run) 진입점 (#842). 확인 카드가 승인 전에 실패를 드러내도록, 쓰기({@code setRoles}) 직전까지의 모든
   * 검증을 수행하되 아무것도 쓰지 않는다. {@link #setUserRolesByNames} 와 같은 {@link #resolveRolesByNames} 를 호출하므로
   * 술어가 두 벌이 되지 않는다.
   *
   * @throws IllegalArgumentException 역할 목록 비어 있음 · 다룰 수 없는 역할 손실 · 역할명 해석 실패 · 자기 ADMIN 제거
   * @throws UserNotFoundException 사용자 없음 · 현재 테넌트 비멤버
   */
  @Transactional(readOnly = true)
  public void validateSetRolesByNames(Long userId, List<String> roleNames, Long callerId) {
    resolveRolesByNames(userId, roleNames, callerId);
  }

  /** 역할명 → roleId 해석 + 전체 검증(쓰기 없음). 실행 경로는 반환된 roleIds 로 setRoles 만 수행한다 (#842). */
  private List<Long> resolveRolesByNames(Long userId, List<String> roleNames, Long callerId) {
    if (roleNames == null || roleNames.isEmpty()) {
      throw new IllegalArgumentException("역할이 비어 있습니다");
    }
    // requireMember/존재 검증은 아래 checkSetRoles 가 수행한다 — 여기서 또 부르면 같은 쿼리를 두 번 돈다.
    // setUserRoles 는 역할 집합을 통째로 교체한다. AI 경로는 ADMIN/USER 두 이름만 다룰 수 있으므로,
    // 대상이 그 밖의 역할(업무별 에이전트의 AGENT 역할, 관리자가 부여한 커스텀 역할)을 갖고 있으면
    // 조용히 사라진다 — 개인 비서가 AGENT 역할을 잃고 기능이 멈추는 식이다. 손실이 생길 상황이면
    // 아예 거부하고 설정 화면으로 안내한다(확인 카드 summary 는 LLM 이 쓰는 자유 텍스트라 손실을 못 드러낸다).
    Set<String> keepable = Set.of("ADMIN", "USER");
    List<String> dropped =
        roleRepository.findByUserId(userId).stream()
            .map(RoleResponse::name)
            .filter(name -> !keepable.contains(name) && !roleNames.contains(name))
            .toList();
    if (!dropped.isEmpty()) {
      throw new IllegalArgumentException(
          "이 사용자는 여기서 다룰 수 없는 역할("
              + String.join(", ", dropped)
              + ")을 갖고 있어 역할을 바꿀 수 없습니다. 설정 > 구성원 화면에서 변경하세요.");
    }
    List<Long> roleIds =
        roleNames.stream()
            .map(
                name ->
                    roleRepository
                        .findByName(name)
                        .orElseThrow(() -> new IllegalArgumentException("역할이 없습니다: " + name))
                        .id())
            .toList();
    // 존재·멤버십·자기 잠금 검증은 실행 경로(setUserRoles)와 동일한 술어를 공유한다.
    checkSetRoles(userId, roleIds, callerId);
    return roleIds;
  }

  @Transactional
  public void setUserActive(Long userId, boolean active) {
    validateSetActive(userId, active);
    userRepository.setActive(userId, active);
  }

  /**
   * 활성/비활성 전환 가능 여부만 판정한다(쓰기 없음). #842 — 확인 카드 사전검증(dry-run)과 실행 경로가 공유하는 술어. {@link
   * #setUserActive} 가 그대로 호출하므로 술어 포크가 없다.
   *
   * @throws UserNotFoundException 사용자 없음 · 현재 테넌트 비멤버
   * @throws IllegalStateException 마지막 활성 ADMIN 을 비활성화하려 함
   */
  @Transactional(readOnly = true)
  public void validateSetActive(Long userId, boolean active) {
    if (!userRepository.existsById(userId)) {
      throw UserNotFoundException.ofId(userId);
    }
    // 대상이 현재 테넌트 멤버가 아니면 타 테넌트 사용자를 비활성화할 수 없다 (#811).
    requireMember(userId);
    // 마지막 활성 ADMIN 비활성화 방지 — 모든 ADMIN이 잠기면 시스템 관리 불가 (#146)
    if (!active && userRepository.hasAdminRole(userId) && userRepository.countActiveAdmins() <= 1) {
      throw new IllegalStateException("마지막 활성 ADMIN 계정은 비활성화할 수 없습니다");
    }
  }
}

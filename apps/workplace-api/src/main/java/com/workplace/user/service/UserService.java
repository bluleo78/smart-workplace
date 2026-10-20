package com.workplace.user.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AuthService;
import com.workplace.auth.service.LoginAttemptService;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.global.util.PersonNames;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.repository.RoleRepository;
import com.workplace.role.service.RoleGrantGuard;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.tenant.repository.TenantRepository;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.CreateMemberRequest;
import com.workplace.user.dto.MemberResponse;
import com.workplace.user.dto.RenameAgentRequest;
import com.workplace.user.dto.UserDetailResponse;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.CurrentPasswordMismatchException;
import com.workplace.user.exception.PersonalAssistantRenameForbiddenException;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.outbound.AgentRuntimeChanged;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import com.workplace.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserService {

  private final UserRepository userRepository;
  private final AgentRuntimePolicy agentRuntimePolicy;
  private final RoleRepository roleRepository;
  private final RoleGrantGuard roleGrantGuard;
  private final PasswordEncoder passwordEncoder;
  private final AuditLogService auditLogService;
  private final MembershipRepository membershipRepository;
  // WP-48: SSO 전용 구성원 등록 시 워크스페이스 SSO 켜짐 여부 확인
  private final TenantRepository tenantRepository;
  // AI 가용성 해석 — 개인/공통 비서 중 active token 보유 여부를 판단. /users/me 응답에 aiAvailable 노출.
  private final AssistantResolver assistantResolver;
  // WP-566: 비밀번호 변경 뒤 다른 세션 refresh 폐기·바꾼 세션 재발급.
  private final AuthService authService;

  private final LoginAttemptService loginAttemptService;
  // 실행 방식 변경 이벤트 발행(AgentRuntimeChanged) — issue 모듈이 AI 작업 기록을 정리한다.
  private final ApplicationEventPublisher publisher;

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
   * 테넌트 사용자에도 접근 가능하므로, 대상이 현재 active 테넌트의 멤버인지 명시 검증한다. 비멤버는 존재 자체를 노출하지 않도록 404(Not Found)로 응답한다
   * — project 도메인의 멤버십 가드와 동일 패턴.
   *
   * <p>WP-417: 정지(SUSPENDED)된 멤버도 멤버로 본다 — 관리자가 정지한 구성원을 사용자 목록·상세에서 계속 보고 다시 활성화할 수 있어야 한다.
   *
   * @return 대상의 이 워크스페이스 멤버십 상태(ACTIVE/SUSPENDED)
   */
  private String requireMember(Long userId) {
    return requireMember(userId, requireTenant());
  }

  /** {@link #requireMember(Long)} 의 테넌트를 이미 받은 호출용. */
  private String requireMember(Long userId, Long tenantId) {
    return membershipRepository
        .findStatus(userId, tenantId)
        .orElseThrow(() -> UserNotFoundException.ofId(userId));
  }

  /**
   * ADMIN 등 타인 조회용(`GET /{id}`) — 대상이 현재 active 테넌트 멤버인지 검증한다 (#811). 비멤버 조회는 404 로 응답해 존재 자체를 숨긴다.
   */
  @Transactional(readOnly = true)
  public UserDetailResponse getUserById(Long id) {
    // WP-417: 관리 화면의 active 는 "이 워크스페이스에서 활성"(공용 정의) — 정지된 멤버도 조회는 된다.
    String status = requireMember(id);
    UserResponse user = loadUser(id);
    return loadUserDetail(user, WorkspaceActive.of(user.isActive(), status));
  }

  /**
   * 본인 프로필 조회용(`GET /me`) — 인증된 principal 이 곧 대상이므로 멤버십 검증이 필요 없다(자기 자신 조회는 항상 허용). AGENT 가 API 키로
   * 인증했지만 아직 어떤 테넌트에도 활성 멤버십이 없어 active 테넌트 컨텍스트가 없는 경우에도(#811 이전부터의 기존 동작) 자기 신원 조회는 막지 않는다.
   */
  @Transactional(readOnly = true)
  public UserDetailResponse getMyProfile(Long userId) {
    // WP-417: active 테넌트가 있으면 그 워크스페이스 기준(실제 멤버십 상태, 비멤버면 비활성), 없으면(테넌트 없는 AGENT 등) 판정할
    // 워크스페이스가 없어 전역 값.
    UserResponse user = loadUser(userId);
    Long tenantId = TenantContext.get();
    boolean active =
        tenantId == null
            ? user.isActive()
            : WorkspaceActive.of(
                user.isActive(), membershipRepository.findStatus(userId, tenantId).orElse(null));
    return loadUserDetail(user, active);
  }

  private UserResponse loadUser(Long id) {
    return userRepository.findById(id).orElseThrow(() -> UserNotFoundException.ofId(id));
  }

  /**
   * @param active 응답 isActive — 호출측이 워크스페이스 기준(WP-417)으로 계산해 넘긴다.
   */
  private UserDetailResponse loadUserDetail(UserResponse user, boolean active) {
    Long id = user.id();
    List<RoleResponse> roles = roleRepository.findByUserId(id);
    // AI 가용성 — 개인 또는 공통 비서(active token) 보유 여부. 프론트가 AI affordance 게이트에 사용.
    boolean aiAvailable = assistantResolver.resolveOrEmpty(id).isPresent();
    return new UserDetailResponse(
        user.id(),
        user.username(),
        user.email(),
        user.name(),
        active,
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
  /** WP-600: 에이전트 아이디에 쓸 수 있는 글자 — 글자(한글 포함)·숫자와 . _ @ + -. 공백·꺾쇠·따옴표·보이지 않는 문자는 막는다. */
  private static final Pattern AGENT_USERNAME = Pattern.compile("[\\p{L}\\p{N}._@+-]+");

  /**
   * 에이전트 아이디를 다듬고 형식을 검사한다(WP-600). 앞뒤 공백이 그대로 저장되면 같은 아이디로 보이는 계정이 생기고, 꺾쇠·보이지 않는 문자는 목록·멘션에서 아이디를
   * 알아볼 수 없게 만든다.
   */
  private static String normalizeAgentUsername(String raw) {
    String username = raw.strip();
    if (!AGENT_USERNAME.matcher(username).matches()) {
      throw new IllegalArgumentException("아이디에는 글자·숫자와 . _ @ + - 만 쓸 수 있습니다");
    }
    return username;
  }

  private String resolveUsername(Long callerId) {
    if (callerId == null) return "system";
    return userRepository.findById(callerId).map(UserResponse::username).orElse("system");
  }

  /**
   * 사용자 관리 행위의 성공 감사 로그 — AGENT 관리(생성·삭제·이름 변경·실행 방식 변경)와 구성원 관리(WP-567: 역할 변경·정지·정지 해제·비밀번호 변경).
   * resource=user, resource_id=대상 사용자 id 로 형식을 맞춘다. callerUsername 은 호출자가 넘긴다: 삭제처럼 대상 행이 사라지기 전에
   * 미리 읽어 둬야 하는 경로가 있어서다.
   */
  private void auditUserAction(
      Long callerId,
      String callerUsername,
      String actionType,
      Long agentId,
      String description,
      Map<String, String> metadata) {
    auditLogService.log(
        callerId,
        callerUsername,
        actionType,
        "user",
        String.valueOf(agentId),
        description,
        null,
        null,
        "SUCCESS",
        null,
        metadata);
  }

  /**
   * Phase 5a — AGENT 유저 생성. ADMIN 권한은 컨트롤러의 @RequirePermission 으로 가드한다. password=NULL, kind='AGENT'
   * 로 저장되며, 기본 AGENT 역할을 부여한다(WP-252) — 역할 0개면 project:read/issue:write 등 권한이 전무해 담당 이슈 조회·처리가 403
   * 으로 막히기 때문. 개인 비서 생성 경로(PersonalAssistantService)와 동일한 방식이며, 추가 역할은 ADMIN 이 개별 설정한다.
   */
  @Transactional
  public UserResponse createAgent(Long callerId, CreateAgentRequest req) {
    String username = normalizeAgentUsername(req.username());
    // WP-600: 대소문자 무시로 중복 검사 — SSO 첫 연결 매칭이 대소문자 무시라, 사람 아이디의 대소문자 변형 에이전트가 생기면 그 사람의 연결이 막힌다.
    if (!userRepository.findIdsByUsernameIgnoreCase(username).isEmpty()) {
      throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
    }
    if (userRepository.existsByEmail(req.email())) {
      throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }
    UserResponse created = userRepository.createAgent(username, req.email(), req.name());
    // 에이전트를 현재 active 테넌트에 귀속 — 콜백 시 단일-멤버십으로 RLS 컨텍스트가 해석되도록.
    // 인증된 ADMIN 경로이므로 active 테넌트가 반드시 있어야 한다(테넌트 없는 고아 에이전트 방지).
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      throw new IllegalStateException("에이전트 생성에는 active 테넌트 컨텍스트가 필요합니다.");
    }
    membershipRepository.create(created.id(), tenantId, "ACTIVE");
    // WP-252: 기본 AGENT 역할 부여 — user_role.tenant_id 는 요청 tx 의 GUC(active 테넌트)로 자동 충전된다.
    // AGENT 역할은 테넌트별로 시드돼 있다(V75 + 신규 테넌트 프로비저닝).
    roleRepository
        .findByName("AGENT")
        .ifPresent(role -> userRepository.addRole(created.id(), role.id()));
    String callerUsername = resolveUsername(callerId);
    // 감사 로그 — AGENT_CREATED (action_type, resource=user, resource_id=신규 user id)
    auditUserAction(
        callerId,
        callerUsername,
        "AGENT_CREATED",
        created.id(),
        "AGENT 유저 생성: " + created.username(),
        Map.of("username", created.username(), "name", created.name()));
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
    // WP-572: 이름 앞뒤 공백·보이지 않는 문자를 다듬고, 비거나 제어 문자가 섞인 이름은 거절한다.
    UserResponse user =
        userRepository.save(username, email, encoded, PersonNames.normalize(req.name()));

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
    // user 는 전역 테이블 — 다른 테넌트 에이전트를 건드리지 못하도록 현재 테넌트 멤버만 허용(비멤버는 404).
    requireMember(userId);
    UserResponse user =
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));
    if (!UserKind.isAgent(user.kind())) {
      throw new IllegalArgumentException("AGENT 유저만 삭제할 수 있습니다");
    }
    String callerUsername = resolveUsername(callerId);
    userRepository.deleteById(userId);
    auditUserAction(
        callerId, callerUsername, "AGENT_DELETED", userId, "AGENT 유저 삭제: " + user.username(), null);
  }

  /**
   * Phase 5a — ADMIN 의 AGENT 이름/식별자/설명(역할, WP-455) 변경. 공통 비서·일반 AGENT 만 대상이며, 개인 비서는 거부(403)한다(소유자만
   * 프로필에서 변경). email 은 변경하지 않는다. 설명은 앞뒤 공백을 걷고, 비었으면 지운다(null).
   *
   * <p>가드 순서: 존재 → AGENT 종류 → 개인 비서 거부 → 예약 접두어(__assistant_u) 차단 → username 중복(자신 제외).
   */
  @Transactional
  public void renameAgent(Long callerId, Long userId, RenameAgentRequest req) {
    // user 는 전역 테이블 — 다른 테넌트 에이전트를 건드리지 못하도록 현재 테넌트 멤버만 허용(비멤버는 404).
    requireMember(userId);
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
    // username 을 바꿀 때만 형식·중복을 본다 — 이름만 바꾸는 경우 기존 아이디는 그대로 통과(옛 규칙으로 만든 아이디 포함).
    String username = req.username().strip();
    if (!username.equals(user.username())) {
      username = normalizeAgentUsername(username);
      // 예약 접두어로 username 을 바꾸면 목록에서 사라지고(개인 비서로 오인) 이후 rename 도 막히므로 차단.
      if (AgentUsernames.isPersonalAssistant(username)) {
        throw new IllegalArgumentException("사용할 수 없는 아이디입니다.");
      }
      // 중복 검사(자신 제외)는 대소문자 무시(WP-600) — 자기 아이디의 대소문자만 바꾸는 것은 허용.
      if (userRepository.findIdsByUsernameIgnoreCase(username).stream()
          .anyMatch(id -> !id.equals(userId))) {
        throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
      }
    }
    // 설명: 빠지면(null) 그대로 둔다 — 설명 칸을 모르는 옛 화면(배포 중·캐시된 PWA)이 이름만 바꿔도 지워지지 않게. 공백뿐이면 지운다.
    String oldDescription = userRepository.findDescription(userId);
    String description =
        req.description() == null
            ? oldDescription
            : (req.description().isBlank() ? null : req.description().strip());
    userRepository.renameAgentIdentity(userId, username, req.name(), description);
    // 감사 로그 — AGENT_RENAMED (이전/이후 username·name 메타).
    // 설명 문구엔 실제로 바뀐 필드만 반영한다 — username 이 그대로인 채 name 만 바뀌면
    // "username → 동일 username" 만 찍혀 변경이 없었던 것처럼 보이는 오해를 방지(#796).
    List<String> changes = new ArrayList<>();
    Map<String, String> meta = new LinkedHashMap<>();
    meta.put("oldUsername", user.username());
    meta.put("newUsername", username);
    meta.put("oldName", user.name());
    meta.put("newName", req.name());
    if (!user.username().equals(username)) {
      changes.add("아이디 " + user.username() + " → " + username);
    }
    if (!user.name().equals(req.name())) {
      changes.add("이름 " + user.name() + " → " + req.name());
    }
    // 설명은 길어서 문구엔 바뀌었다는 사실만 남기고, 전후 값(없으면 빈 문자열)은 메타에 둔다.
    if (!Objects.equals(oldDescription, description)) {
      changes.add("설명 변경");
      meta.put("oldDescription", Objects.requireNonNullElse(oldDescription, ""));
      meta.put("newDescription", Objects.requireNonNullElse(description, ""));
    }
    auditUserAction(
        callerId,
        resolveUsername(callerId),
        "AGENT_RENAMED",
        userId,
        "AGENT 유저 변경: " + (changes.isEmpty() ? "변경 없음" : String.join(", ", changes)),
        meta);
  }

  /**
   * WP-371 — AGENT 실행 방식(INTERNAL|EXTERNAL) 변경.
   *
   * <p>가드: 현재 테넌트 멤버가 아니거나 AGENT 가 아니면 404(사람은 대상이 아님). EXTERNAL 로 바꾸려는데 공통 비서이거나 누군가의 개인 비서이면 409
   * — 둘 다 AI Chat 을 서버(ai-agent)가 실행해야 하기 때문(판정·락은 {@link AgentRuntimePolicy}). INTERNAL 로의 변경은 항상
   * 허용. 변경 시 AgentRuntimeChanged 이벤트를 발행하고 감사 로그 AGENT_RUNTIME_CHANGED 를 남긴다.
   */
  @Transactional
  public void setAgentRuntime(Long callerId, Long userId, String runtime) {
    // user 는 전역 테이블 — 현재 테넌트 멤버가 아닌 에이전트는 존재 자체를 숨겨 404.
    requireMember(userId);
    // 공통 비서 지정(WorkspaceAssistantService.setAgent)과 같은 에이전트 행 락으로 직렬화 — 검사와 변경 사이 경합 방지.
    agentRuntimePolicy.lock(userId);
    UserResponse user =
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));
    if (!UserKind.isAgent(user.kind())) {
      throw UserNotFoundException.ofId(userId);
    }
    // INTERNAL 로의 변경은 불변식을 깨지 않으므로 항상 허용한다.
    if (AgentRuntime.EXTERNAL.equals(runtime)) {
      agentRuntimePolicy.requireMayBeExternal(userId);
    }
    // 값이 실제로 바뀐 경우에만 true — 같은 값으로의 호출(재시도·중복 클릭)이면 변경 이벤트를 내지 않는다(리스너의 작업 기록 정리·생성이 헛돌지 않게).
    boolean changed = userRepository.updateAgentRuntime(userId, runtime);
    // 같은 트랜잭션 안에서 동기 처리되는 리스너가 이 에이전트의 AI 작업 기록을 실행 방식에 맞게 정리한다(EXTERNAL→INTERNAL 이면 "시작 전" 취소, 반대면
    // 담당 이슈마다 생성).
    if (changed) publisher.publishEvent(new AgentRuntimeChanged(userId, runtime));
    auditUserAction(
        callerId,
        resolveUsername(callerId),
        "AGENT_RUNTIME_CHANGED",
        userId,
        "AGENT 실행 방식 변경: " + user.username() + " → " + runtime,
        Map.of("username", user.username(), "runtime", runtime));
  }

  @Transactional
  public void updateProfile(Long userId, String rawName, String email) {
    // WP-572: 이름 앞뒤 공백·보이지 않는 문자를 다듬고, 비거나 제어 문자가 섞인 이름은 거절한다.
    String name = PersonNames.normalize(rawName);
    UserResponse user =
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));

    if (email != null && !email.equals(user.email())) {
      if (userRepository.existsByEmailExcludingUser(email, userId)) {
        // WP-571: 다른 사람이 쓰는 이메일을 문구에 되돌려 싣지 않는다.
        throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다");
      }
    }

    userRepository.update(userId, name, email);
  }

  /**
   * 본인 비밀번호 변경·최초 설정.
   *
   * @return 일반 변경이면 바꾼 브라우저 세션이 이어 쓸 새 refresh 토큰(WP-566 — 옛 세션은 모두 폐기된다), 브라우저 세션이 아니거나 SSO 전용 계정의
   *     최초 설정이면 null
   */
  @Transactional(noRollbackFor = CurrentPasswordMismatchException.class)
  public String changePassword(
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
      return null;
    }
    // WP-626: 현재 비밀번호 확인이 대입 창구가 되지 않게 로그인과 같은 계정별 실패 카운터(5회·15분)를 함께 쓴다 — 탈취한 토큰으로
    // 현재 비밀번호를 무제한 추측해 바꿔 계정을 가져가거나, 로그인 잠금을 우회해 비밀번호를 맞혀 보는 길을 막는다.
    String username = resolveUsername(userId);
    if (loginAttemptService.isBlocked(username)) {
      throw new AccountLockedException("비밀번호를 여러 번 틀려 잠시 막았습니다. 15분 뒤 다시 시도해 주세요.");
    }
    // 현재 비밀번호 불일치 시 400 Bad Request로 명확한 한국어 메시지 반환 (#27)
    if (currentPassword == null
        || !passwordEncoder.matches(currentPassword, storedPassword.get())) {
      // 카운터는 별도 트랜잭션(REQUIRES_NEW)에, 실패 감사는 롤백하지 않는 이 트랜잭션에 남긴다.
      loginAttemptService.loginFailed(username);
      auditLogService.log(
          userId,
          username,
          "PASSWORD_CHANGE_FAILED",
          "user",
          String.valueOf(userId),
          "비밀번호 변경 실패 — 현재 비밀번호 불일치",
          null,
          null,
          "FAILURE",
          null,
          null);
      throw new CurrentPasswordMismatchException();
    }
    loginAttemptService.loginSucceeded(username);
    userRepository.updatePassword(userId, passwordEncoder.encode(newPassword));
    // WP-567: 본인 비밀번호 변경 기록(행위자=대상=본인).
    auditUserAction(userId, username, "PASSWORD_CHANGED", userId, "비밀번호 변경", null);
    // WP-566: 다른 기기·브라우저 세션을 끊는다(바꾼 브라우저 세션은 돌려준 새 refresh 토큰으로 이어진다).
    return authService.revokeSessionsAfterPasswordChange(userId, TenantContext.get(), authMethod);
  }

  @Transactional
  public void setUserRoles(Long userId, List<Long> roleIds, Long callerId) {
    // WP-420: 판정 전에 테넌트 관리자 잠금(동시 정지·역할 변경과 직렬화).
    Long tenantId = lockTenantAdmins();
    checkSetRoles(userId, roleIds, callerId, tenantId);
    replaceRoles(userId, roleIds, callerId);
  }

  /**
   * WP-420: 현재 테넌트를 확정하고 테넌트 관리자 잠금을 잡은 뒤 그 테넌트 id 를 돌려준다. 마지막 활성 ADMIN 판정 전에 실행 경로(역할 교체·활성 전환)의
   * 첫머리에서 부른다 — 두 관리자가 서로를 동시에 정지·강등하면 둘 다 "2명"을 보고 통과해 0명이 되던 write skew 를 직렬화로 막는다. 사전검증(확인 카드
   * 미리보기)은 잠금 없이 판정한다.
   */
  private Long lockTenantAdmins() {
    Long tenantId = requireTenant();
    userRepository.acquireTenantAdminLock(tenantId);
    return tenantId;
  }

  /**
   * WP-420: 대상이 이 워크스페이스의 활성 ADMIN 이고 그런 ADMIN 이 그 하나뿐인지. 정지·ADMIN 역할 제거가 활성 ADMIN 수를 0으로 만드는지 판정하는
   * 공용 술어 — 대상이 지금 활성 ADMIN 일 때만 수가 줄어드므로 그때만 센다.
   */
  private boolean isLastActiveAdmin(Long userId, Long tenantId) {
    return userRepository.isWorkspaceActiveAdmin(userId, tenantId)
        && userRepository.countActiveAdmins(tenantId) <= 1;
  }

  /**
   * 역할 교체 술어 본체(쓰기 없음) — 존재·테넌트 멤버십·자기 잠금 방지·마지막 활성 ADMIN 보호. 실행/사전검증 양쪽이 공유한다 (#842). 잠금은 실행 경로만
   * 잡는다(사전검증은 확인 카드 미리보기라 잠금 없이 판정한다).
   */
  private void checkSetRoles(Long userId, List<Long> roleIds, Long callerId, Long tenantId) {
    if (!userRepository.existsById(userId)) {
      throw UserNotFoundException.ofId(userId);
    }
    // 대상이 현재 테넌트 멤버가 아니면 타 테넌트 사용자의 전역 역할을 바꿀 수 없다 (#811).
    requireMember(userId, tenantId);
    // WP-570: 이 워크스페이스에 없는 역할 id(없는 id·다른 테넌트 역할)는 FK 위반(영어 409)이 되기 전에 한국어로 거절한다.
    // role 은 RLS 대상이라 findAll 은 현재 테넌트 역할만 돌려준다.
    if (roleIds != null) {
      Set<Long> known =
          roleRepository.findAll().stream().map(RoleResponse::id).collect(Collectors.toSet());
      if (!known.containsAll(roleIds)) {
        throw new IllegalArgumentException("없는 역할이 포함되어 있습니다");
      }
    }
    // WP-599: ADMIN 이 아니면 자기 권한 안의 역할만 주고뺄 수 있다(role:assign 만으로 자기에게 ADMIN 을 주던 권한 상승 차단).
    roleGrantGuard.requireCanChangeRoles(
        callerId,
        roleRepository.findByUserId(userId).stream().map(RoleResponse::id).toList(),
        roleIds == null ? List.of() : roleIds);
    Optional<RoleResponse> adminRole = roleRepository.findByName("ADMIN");
    if (adminRole.isEmpty()) return;
    boolean wouldRemoveAdmin = roleIds == null || !roleIds.contains(adminRole.get().id());
    if (!wouldRemoveAdmin) return;
    // 자기 자신의 ADMIN 역할 제거 차단 — 자기 잠금(self-lockout) 방지 (#57)
    if (userId.equals(callerId)) {
      boolean hasAdminNow =
          roleRepository.findByUserId(userId).stream()
              .anyMatch(r -> r.id().equals(adminRole.get().id()));
      if (hasAdminNow) {
        throw new IllegalArgumentException("자신의 ADMIN 역할은 제거할 수 없습니다");
      }
    }
    // WP-420: 다른 사람이 마지막 활성 ADMIN 의 ADMIN 역할을 빼도 워크스페이스 관리가 불가능해진다 — 정지와 같은 규칙(409).
    // 대상이 지금 이 워크스페이스의 활성 ADMIN 일 때만 수가 줄어드므로 그때만 센다(정지된 ADMIN 의 역할 정리는 허용).
    if (isLastActiveAdmin(userId, tenantId)) {
      throw new IllegalStateException("마지막 활성 ADMIN 의 ADMIN 역할은 제거할 수 없습니다");
    }
  }

  /**
   * 역할명(ADMIN/USER)으로 역할을 교체한다 (#833). AI 확인 카드 경로용 — 에이전트는 roleId 를 알 수 없고, 역할 목록 조회에는 role:read 가
   * 필요해 에이전트에 권한을 더 주게 된다. 이름→id 해석을 서버(=사람 권한으로 실행되는 실행기)에서 수행해 에이전트 권한을 조회 전용으로 유지한다.
   */
  @Transactional
  public void setUserRolesByNames(Long userId, List<String> roleNames, Long callerId) {
    // WP-420: 실행 경로만 판정 전에 테넌트 관리자 잠금(사전검증 validateSetRolesByNames 는 잠금 없음).
    Long tenantId = lockTenantAdmins();
    List<Long> roleIds = resolveRolesByNames(userId, roleNames, callerId, tenantId);
    replaceRoles(userId, roleIds, callerId);
  }

  /**
   * 역할 집합을 통째로 바꾸고, 실제로 달라졌으면 감사 로그를 남긴다(WP-567 — ADMIN 부여 같은 권한 상승을 나중에 추적할 수 있게). 화면(roleId)·AI
   * 확인카드(역할명) 두 실행 경로가 함께 쓴다.
   */
  private void replaceRoles(Long userId, List<Long> roleIds, Long callerId) {
    List<String> before = roleNamesOf(userId);
    userRepository.setRoles(userId, roleIds);
    List<String> after = roleNamesOf(userId);
    if (before.equals(after)) return;
    String beforeText = before.isEmpty() ? "없음" : String.join(", ", before);
    String afterText = after.isEmpty() ? "없음" : String.join(", ", after);
    auditUserAction(
        callerId,
        resolveUsername(callerId),
        "MEMBER_ROLES_CHANGED",
        userId,
        "구성원 역할 변경: " + resolveUsername(userId) + " (" + beforeText + " → " + afterText + ")",
        Map.of("before", String.join(",", before), "after", String.join(",", after)));
  }

  /** 현재 테넌트에서 사용자가 가진 역할 이름(정렬) — 역할 변경 전후 비교용. */
  private List<String> roleNamesOf(Long userId) {
    return roleRepository.findByUserId(userId).stream().map(RoleResponse::name).sorted().toList();
  }

  /**
   * 역할명 기반 역할 교체의 사전검증(dry-run) 진입점 (#842). 확인 카드가 승인 전에 실패를 드러내도록, 쓰기({@code setRoles}) 직전까지의 모든
   * 검증을 수행하되 아무것도 쓰지 않는다. {@link #setUserRolesByNames} 와 같은 {@link #resolveRolesByNames} 를 호출하므로
   * 술어가 두 벌이 되지 않는다.
   *
   * @throws IllegalArgumentException 역할 목록 비어 있음 · 다룰 수 없는 역할 손실 · 역할명 해석 실패 · 자기 ADMIN 제거
   * @throws IllegalStateException 마지막 활성 ADMIN 의 ADMIN 역할 제거 (WP-420)
   * @throws UserNotFoundException 사용자 없음 · 현재 테넌트 비멤버
   */
  @Transactional(readOnly = true)
  public void validateSetRolesByNames(Long userId, List<String> roleNames, Long callerId) {
    resolveRolesByNames(userId, roleNames, callerId, requireTenant());
  }

  /** 역할명 → roleId 해석 + 전체 검증(쓰기 없음). 실행 경로는 반환된 roleIds 로 setRoles 만 수행한다 (#842). */
  private List<Long> resolveRolesByNames(
      Long userId, List<String> roleNames, Long callerId, Long tenantId) {
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
    checkSetRoles(userId, roleIds, callerId, tenantId);
    return roleIds;
  }

  /**
   * WP-417: 워크스페이스 관리자의 「활성 상태」 토글 — 전역 계정(user.is_active)이 아니라 <b>현재 워크스페이스 멤버십</b>만
   * 정지(SUSPENDED)·재개(ACTIVE)한다. 전역 값을 바꾸면 한 워크스페이스에서 끈 사용자가 다른 워크스페이스·운영자 콘솔 로그인까지 막혔다. 정지된 멤버는 이
   * 워크스페이스 선택·토큰 갱신·구성원 검색·담당자 지정에서 빠지고(ACTIVE 멤버십 술어), 다른 워크스페이스는 그대로 쓴다.
   */
  @Transactional
  public void setUserActive(Long userId, boolean active, Long callerId) {
    // WP-420: 판정 전에 테넌트 관리자 잠금(사전검증 validateSetActive 는 잠금 없음).
    Long tenantId = lockTenantAdmins();
    checkSetActive(userId, active, callerId, tenantId);
    int changed =
        membershipRepository.updateStatus(
            userId,
            tenantId,
            active ? MembershipRepository.STATUS_ACTIVE : MembershipRepository.STATUS_SUSPENDED);
    // WP-420: 실제로 ACTIVE→SUSPENDED 로 바뀐 경우에만 커밋 후 그 사용자의 열린 연결(SSE·노트 공동편집)을 닫거나 재검증하게 알린다.
    // 이미 정지된 멤버를 다시 끄는 멱등 호출은 아무것도 내보내지 않는다. 새 요청은 JWT 필터가 멤버십으로 막는다.
    if (!active && changed > 0)
      publisher.publishEvent(new WorkspaceMembershipSuspended(tenantId, userId));
    // WP-567: 실제로 상태가 바뀐 경우에만 정지·정지 해제를 기록한다(멱등 호출은 남기지 않는다).
    if (changed > 0) {
      String target = resolveUsername(userId);
      auditUserAction(
          callerId,
          resolveUsername(callerId),
          active ? "MEMBER_REACTIVATED" : "MEMBER_SUSPENDED",
          userId,
          (active ? "구성원 정지 해제: " : "구성원 정지: ") + target,
          null);
    }
  }

  /**
   * 활성/비활성 전환 가능 여부만 판정한다(쓰기 없음). #842 — 확인 카드 사전검증(dry-run)과 실행 경로가 공유하는 술어. {@link
   * #setUserActive} 도 같은 본체(checkSetActive)를 호출하므로 술어 포크가 없다.
   *
   * @throws UserNotFoundException 사용자 없음 · 현재 테넌트 비멤버(정지된 멤버는 멤버로 본다 — 재활성화 가능, WP-417)
   * @throws IllegalStateException 마지막 활성 ADMIN 을 비활성화하려 함
   */
  @Transactional(readOnly = true)
  public void validateSetActive(Long userId, boolean active, Long callerId) {
    checkSetActive(userId, active, callerId, requireTenant());
  }

  /** {@link #validateSetActive} 술어 본체 — 실행 경로는 잠금과 함께 이미 확정한 테넌트를 넘긴다. */
  private void checkSetActive(Long userId, boolean active, Long callerId, Long tenantId) {
    if (!userRepository.existsById(userId)) {
      throw UserNotFoundException.ofId(userId);
    }
    // WP-568: 자기 자신 정지 차단 — 자기 ADMIN 제거(#57)와 같은 자기 잠금 방지. 화면만 막으면 API·AI 확인카드 경로로 잠길 수 있었다.
    if (!active && userId.equals(callerId)) {
      throw new IllegalArgumentException("자기 자신은 정지할 수 없습니다");
    }
    // 대상이 현재 테넌트 멤버가 아니면 타 테넌트 사용자를 비활성화할 수 없다 (#811).
    requireMember(userId, tenantId);
    // 마지막 활성 ADMIN 비활성화 방지 — 모든 ADMIN이 잠기면 시스템 관리 불가 (#146).
    // WP-417: 활성 ADMIN 수는 현재 워크스페이스 기준 — 다른 워크스페이스의 정지는 영향 없다. 대상이 지금 이 워크스페이스의 활성 ADMIN 일 때만
    // 끄기가 그 수를 줄이므로 그때만 검사한다(이미 정지된 대상을 다시 끄는 것은 멱등 no-op).
    if (!active && isLastActiveAdmin(userId, tenantId)) {
      throw new IllegalStateException("마지막 활성 ADMIN 계정은 비활성화할 수 없습니다");
    }
  }
}

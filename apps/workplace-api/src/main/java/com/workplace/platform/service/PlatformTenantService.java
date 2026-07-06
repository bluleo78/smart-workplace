package com.workplace.platform.service;

import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.platform.dto.AddExistingTenantMemberRequest;
import com.workplace.platform.dto.AddTenantMemberRequest;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.dto.TenantMemberResponse;
import com.workplace.platform.dto.TenantSummaryResponse;
import com.workplace.platform.exception.PlatformTenantNotFoundException;
import com.workplace.platform.exception.TenantMemberAlreadyExistsException;
import com.workplace.platform.repository.PlatformTenantRepository;
import com.workplace.platform.util.IdentityMasking;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영자 콘솔 — 테넌트 생성/목록/상세/정지/활성화/멤버 조회.
 *
 * <p>⚠️ {@link #createTenant} 만 {@code @Transactional}(단일 트랜잭션)이다. tenant + OWNER 멤버십 + 기본 RBAC 시드를
 * 한 트랜잭션·한 커넥션으로 원자 처리해야 한다(Task 6). 이렇게 해야 role.tenant_id FK 가 같은 트랜잭션의 미커밋 tenant 행을 보고, 트랜잭션-로컬
 * GUC 로 RLS WITH CHECK 를 통과한다. 시드 중간 실패 시 tenant 까지 함께 롤백되어 고아 테넌트가 남지 않는다. (이전의 "commit-first + 별도
 * 커넥션 가시성" 설계는 폐기됨 — 되돌리지 말 것.)
 */
@Service
@RequiredArgsConstructor
public class PlatformTenantService {

  private final PlatformTenantRepository platformTenantRepository;
  private final TenantProvisioningService tenantProvisioningService;
  private final UserRepository userRepository;
  // 멤버 추가(#497) 시 계정 비밀번호를 인코딩한다 — 로그인이 검증하는 PasswordEncoder 빈과 동일해야 한다.
  private final PasswordEncoder passwordEncoder;

  /**
   * 테넌트 생성 — slug 중복·owner 존재 검증 후 tenant + OWNER 멤버십 + 기본 RBAC 시드를 단일 트랜잭션으로 처리. 생성된 상세를 반환.
   *
   * <p>{@code @Transactional}: tenant/membership(전역 테이블) → 신규 테넌트 GUC 설정 →
   * role/role_permission/user_role 시드까지 같은 커넥션에서 원자 실행. createTenantWithOwner 의
   * {@code @Transactional} 은 REQUIRED 로 이 트랜잭션에 합류한다.
   */
  @Transactional
  public TenantDetailResponse createTenant(CreateTenantRequest req) {
    // slug 가 지정된 경우 전역 유일성 검증(중복이면 400).
    if (req.slug() != null && platformTenantRepository.slugExists(req.slug())) {
      throw new IllegalArgumentException("이미 사용 중인 slug 입니다: " + req.slug());
    }
    // 초기 소유자를 지정한 경우에만 기존 사용자인지 검증한다(지정 시 없으면 400). 비우면 소유자 없는 빈 테넌트.
    if (req.ownerUserId() != null && !userRepository.existsById(req.ownerUserId())) {
      throw new IllegalArgumentException("존재하지 않는 사용자입니다: " + req.ownerUserId());
    }
    // tenant + OWNER 멤버십(전역 테이블, GUC 무관). createTenantWithOwner 는 REQUIRED 로 이 tx 에 합류한다.
    Long tenantId =
        platformTenantRepository.createTenantWithOwner(req.name(), req.slug(), req.ownerUserId());
    // 같은 트랜잭션/커넥션에서 신규 테넌트 GUC 로 RBAC 시드(FK 가 미커밋 tenant 를 봄, RLS WITH CHECK 통과).
    tenantProvisioningService.seedDefaultRoles(tenantId, req.ownerUserId());
    // 같은 트랜잭션에서 다시 조회해 일관된 상세(멤버 수 포함)를 반환.
    return platformTenantRepository
        .findTenant(tenantId)
        .orElseThrow(() -> new IllegalStateException("테넌트 생성 직후 조회에 실패했습니다: " + tenantId));
  }

  /** 전체 테넌트 목록(멤버 수 포함). */
  public List<TenantSummaryResponse> listTenants() {
    return platformTenantRepository.listTenants();
  }

  /** 테넌트 상세 — 없으면 404. */
  public TenantDetailResponse getTenant(Long id) {
    return platformTenantRepository
        .findTenant(id)
        .orElseThrow(() -> new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + id));
  }

  /** 테넌트 정지(SUSPENDED) — 없으면 404. */
  public void suspend(Long id) {
    if (platformTenantRepository.updateStatus(id, "SUSPENDED") == 0) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + id);
    }
  }

  /** 테넌트 활성화(ACTIVE) — 없으면 404. */
  public void activate(Long id) {
    if (platformTenantRepository.updateStatus(id, "ACTIVE") == 0) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + id);
    }
  }

  /**
   * 테넌트 드라이브 한도 변경 후 갱신된 상세를 반환한다(#81).
   *
   * <p>없는 테넌트 id 이면 PlatformTenantNotFoundException(404).
   */
  @Transactional
  public TenantDetailResponse updateQuota(Long id, long quotaBytes) {
    platformTenantRepository.updateQuota(id, quotaBytes);
    return getTenant(id);
  }

  /**
   * 테넌트 멤버 목록 — 테넌트가 없으면 404.
   *
   * <p>운영자는 개별 멤버를 식별할 수 없어야 하므로, 플랫폼 운영자(isPlatformOperator)가 아닌 멤버의 이름·username·email 을 서버측에서 부분
   * 마스킹해 반환한다(원본 PII 는 클라이언트로 내려보내지 않는다). 본인(조회 운영자)도 플랫폼 운영자이므로 이 규칙으로 함께 원본 노출된다.
   */
  public List<TenantMemberResponse> getMembers(Long tenantId) {
    if (platformTenantRepository.findTenant(tenantId).isEmpty()) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + tenantId);
    }
    return platformTenantRepository.findMembers(tenantId).stream().map(this::maskIfNeeded).toList();
  }

  /** 플랫폼 운영자가 아닌 멤버의 신원(이름·username·email)을 부분 마스킹한다. */
  private TenantMemberResponse maskIfNeeded(TenantMemberResponse m) {
    if (m.isPlatformOperator()) {
      return m;
    }
    return new TenantMemberResponse(
        m.userId(),
        IdentityMasking.maskEmailLike(m.username()),
        IdentityMasking.maskName(m.name()),
        IdentityMasking.maskEmailLike(m.email()),
        m.role(),
        m.status(),
        false);
  }

  /**
   * 테넌트에 멤버(소유자/일반)를 추가한다 — 계정을 새로 만들고 멤버십 + RBAC 역할까지 부여한다(#497).
   *
   * <p>공개 가입이 닫힌 모델에서 신규 사용자 계정은 이 경로로 생성된다. 두 역할 축을 분리해 부여한다: 멤버십 직위(OWNER/MEMBER) 와 RBAC
   * 역할(OWNER→ADMIN, MEMBER→USER). 로그인 아이디(username)는 이메일을 사용하고 비밀번호는 로그인과 동일한 PasswordEncoder 로
   * 인코딩한다.
   *
   * <p>{@code @Transactional}: user/membership(전역) INSERT 와 RBAC user_role(RLS 대상, 신규 테넌트 GUC 하)
   * 할당을 한 트랜잭션·한 커넥션에서 원자 실행한다. 중간 실패 시 계정·멤버십까지 함께 롤백되어 고아 계정이 남지 않는다.
   *
   * @return 추가된 멤버 항목
   */
  @Transactional
  public TenantMemberResponse addMember(Long tenantId, AddTenantMemberRequest req) {
    // 대상 테넌트가 존재해야 한다(없으면 404).
    if (platformTenantRepository.findTenant(tenantId).isEmpty()) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + tenantId);
    }
    // 로그인 아이디 = 이메일. 아이디/이메일 중복은 409.
    String email = req.email();
    if (userRepository.existsByUsername(email)) {
      throw new UsernameAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }
    if (userRepository.existsByEmail(email)) {
      throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }
    // 계정 생성 — 비밀번호는 로그인이 검증하는 동일 인코더로. is_active 는 DB DEFAULT TRUE(즉시 로그인 가능).
    String encodedPassword = passwordEncoder.encode(req.password());
    UserResponse user = userRepository.save(email, email, encodedPassword, req.name());

    // 두 역할 축 분리: 멤버십 직위(OWNER/MEMBER) vs RBAC 역할(ADMIN/USER).
    boolean isOwner = "OWNER".equals(req.role());
    String membershipRole = isOwner ? "OWNER" : "MEMBER";
    String rbacRole = isOwner ? "ADMIN" : "USER";

    // 멤버십(전역) + RBAC 역할(신규 테넌트 GUC 하) 부여. 같은 트랜잭션·커넥션에서 원자 실행.
    platformTenantRepository.addMembership(user.id(), tenantId, membershipRole);
    platformTenantRepository.assignTenantRoleByName(tenantId, user.id(), rbacRole);

    return new TenantMemberResponse(
        user.id(), user.username(), user.name(), user.email(), membershipRole, "ACTIVE", false);
  }

  /**
   * 기존(전역) 사용자를 테넌트 멤버로 추가한다 — 계정 생성 없이 membership + RBAC 역할만 부여한다.
   *
   * <p>이미 해당 테넌트 멤버면 409. 다른 테넌트 소속이거나 플랫폼 운영자(is_platform_admin)여도 허용한다 — 계정은 전역이므로 다중 테넌트 소속이 정상
   * 케이스다.
   *
   * <p>{@code @Transactional}: membership(전역) INSERT 와 RBAC user_role(RLS 대상, 신규 테넌트 GUC 하) 할당을 한
   * 트랜잭션·한 커넥션에서 원자 실행한다.
   *
   * @return 추가된 멤버 항목
   */
  @Transactional
  public TenantMemberResponse addExistingMember(Long tenantId, AddExistingTenantMemberRequest req) {
    if (platformTenantRepository.findTenant(tenantId).isEmpty()) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + tenantId);
    }
    var user =
        userRepository
            .findById(req.userId())
            .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 사용자입니다: " + req.userId()));
    if (platformTenantRepository.hasActiveMembership(user.id(), tenantId)) {
      throw new TenantMemberAlreadyExistsException("이미 이 테넌트의 멤버입니다: " + user.id());
    }

    boolean isOwner = "OWNER".equals(req.role());
    String membershipRole = isOwner ? "OWNER" : "MEMBER";
    String rbacRole = isOwner ? "ADMIN" : "USER";

    platformTenantRepository.addMembership(user.id(), tenantId, membershipRole);
    platformTenantRepository.assignTenantRoleByName(tenantId, user.id(), rbacRole);

    return new TenantMemberResponse(
        user.id(),
        user.username(),
        user.name(),
        user.email(),
        membershipRole,
        "ACTIVE",
        platformTenantRepository.isPlatformOperator(user.id()));
  }
}

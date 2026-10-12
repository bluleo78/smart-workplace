package com.workplace.platform.service;

import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.global.tenant.DefaultTenant;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.platform.dto.AddExistingTenantMemberRequest;
import com.workplace.platform.dto.AddTenantMemberRequest;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.dto.TenantMemberResponse;
import com.workplace.platform.dto.TenantSummaryResponse;
import com.workplace.platform.dto.UpdateTenantRequest;
import com.workplace.platform.exception.PlatformTenantNotFoundException;
import com.workplace.platform.exception.TenantMemberAlreadyExistsException;
import com.workplace.platform.exception.TenantStateConflictException;
import com.workplace.platform.repository.PlatformTenantRepository;
import com.workplace.platform.util.IdentityMasking;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.text.Normalizer;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영자 콘솔 — 테넌트 생성/목록/상세/정지/활성화/삭제/복원/영구 삭제 요청/멤버 조회.
 *
 * <p>상태 전환(WP-341): ACTIVE ⇄ SUSPENDED, ACTIVE·SUSPENDED → DELETED(삭제), DELETED → ACTIVE(복원),
 * DELETED → PURGING(영구 삭제 요청 — 실제 삭제는 백그라운드 잡). 모든 전환은 현재 상태를 WHERE 에 거는 조건부 UPDATE 라 경합 시 하나만
 * 성공한다.
 *
 * <p>⚠️ {@link #createTenant} 만 {@code @Transactional}(단일 트랜잭션)이다. tenant + OWNER 멤버십 + 기본 RBAC 시드를
 * 한 트랜잭션·한 커넥션으로 원자 처리해야 한다(Task 6). 이렇게 해야 role.tenant_id FK 가 같은 트랜잭션의 미커밋 tenant 행을 보고, 트랜잭션-로컬
 * GUC 로 RLS WITH CHECK 를 통과한다. 시드 중간 실패 시 tenant 까지 함께 롤백되어 고아 테넌트가 남지 않는다. (이전의 "commit-first + 별도
 * 커넥션 가시성" 설계는 폐기됨 — 되돌리지 말 것.)
 */
@Service
@RequiredArgsConstructor
public class PlatformTenantService {

  /** 운영 중(구성원 접근·편집 가능) 상태 — 삭제 가능한 출발 상태이자 편집 가드 기준. */
  private static final List<String> LIVE = List.of("ACTIVE", "SUSPENDED");

  private final PlatformTenantRepository platformTenantRepository;
  private final TenantProvisioningService tenantProvisioningService;
  private final UserRepository userRepository;
  // 멤버 추가(#497) 시 계정 비밀번호를 인코딩한다 — 로그인이 검증하는 PasswordEncoder 빈과 동일해야 한다.
  private final PasswordEncoder passwordEncoder;
  // WP-341: 상태 전환 직후 이 파드의 테넌트 상태 캐시를 비워 기존 토큰 차단/해제를 즉시 반영한다.
  private final TenantStatusChecker tenantStatusChecker;

  /**
   * 테넌트 생성 — slug 중복·owner 존재 검증 후 tenant + OWNER 멤버십 + 기본 RBAC 시드를 단일 트랜잭션으로 처리. 생성된 상세를 반환.
   *
   * <p>slug 를 비우면(null/공백) 이름에서 자동 생성한다(#695) — 콘솔의 "비우면 자동 생성" 안내와 동작을 일치시키며 NULL slug 는 더 이상 저장되지
   * 않는다.
   *
   * <p>{@code @Transactional}: tenant/membership(전역 테이블) → 신규 테넌트 GUC 설정 →
   * role/role_permission/user_role 시드까지 같은 커넥션에서 원자 실행. createTenantWithOwner 의
   * {@code @Transactional} 은 REQUIRED 로 이 트랜잭션에 합류한다.
   */
  @Transactional
  public TenantDetailResponse createTenant(CreateTenantRequest req) {
    // slug 결정(#695): 지정했으면 전역 유일성 검증(중복이면 400), 비웠으면 이름에서 자동 생성.
    String slug = resolveSlug(req.slug(), req.name(), null);
    // 초기 소유자를 지정한 경우에만 검증한다(지정 시 없으면 400). 비우면 소유자 없는 빈 테넌트.
    // 콘솔은 이메일 정확일치로 아무 계정이나 찾을 수 있으므로, 에이전트·비활성 계정이 소유자가 되지 않게 서버에서 막는다(WP-337).
    if (req.ownerUserId() != null) {
      UserResponse ownerUser =
          userRepository
              .findById(req.ownerUserId())
              .orElseThrow(
                  () -> new IllegalArgumentException("존재하지 않는 사용자입니다: " + req.ownerUserId()));
      if (!ownerUser.isActiveHuman()) {
        throw new IllegalArgumentException("에이전트나 비활성 계정은 소유자로 지정할 수 없습니다: " + req.ownerUserId());
      }
    }
    // tenant + OWNER 멤버십(전역 테이블, GUC 무관). createTenantWithOwner 는 REQUIRED 로 이 tx 에 합류한다.
    Long tenantId =
        platformTenantRepository.createTenantWithOwner(req.name(), slug, req.ownerUserId());
    // 같은 트랜잭션/커넥션에서 신규 테넌트 GUC 로 RBAC 시드(FK 가 미커밋 tenant 를 봄, RLS WITH CHECK 통과).
    tenantProvisioningService.seedDefaultRoles(tenantId, req.ownerUserId());
    // 같은 트랜잭션에서 다시 조회해 일관된 상세(멤버 수 포함)를 반환.
    return platformTenantRepository
        .findTenant(tenantId)
        .orElseThrow(() -> new IllegalStateException("테넌트 생성 직후 조회에 실패했습니다: " + tenantId));
  }

  /** slug 자동 생성 시 이름에서 ASCII 문자가 하나도 안 나올 때(한글 전용 이름 등) 쓰는 기본 base. */
  public static final String DEFAULT_SLUG_BASE = "tenant";

  /** tenant.slug 컬럼 길이(VARCHAR(64)) — 자동 생성 slug 가 넘지 않게 자른다. */
  private static final int MAX_SLUG_LENGTH = 64;

  /**
   * 테넌트 이름에서 slug base 를 만든다(#695) — 소문자 ASCII 영숫자 외 문자는 하이픈으로 접고 양끝 하이픈 제거.
   *
   * <p>악센트 문자는 NFD 분해 후 결합 기호를 버려 기본 알파벳으로 남긴다(예: "Café" → "cafe"). 한글처럼 ASCII 로 환원되지 않는 문자만 있으면 빈
   * 문자열이 되므로 {@link #DEFAULT_SLUG_BASE} 를 쓴다. slug 는 향후 서브도메인 라우팅 등에 쓰일 수 있어 ASCII 소문자·숫자·하이픈만
   * 허용한다.
   */
  public static String slugify(String name) {
    String decomposed = Normalizer.normalize(name == null ? "" : name, Normalizer.Form.NFD);
    String base =
        decomposed
            .replaceAll("\\p{M}+", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", "-")
            .replaceAll("^-+|-+$", "");
    return base.isEmpty() ? DEFAULT_SLUG_BASE : base;
  }

  /**
   * 요청 slug 를 확정한다 — 생성(#695)·수정(WP-336) 공통. 공백을 다듬어 비었으면 이름에서 자동 생성하고, 지정했으면 다른 테넌트와 겹칠 때
   * 400(IllegalArgumentException). excludeId 는 수정 대상 테넌트 자신(생성 시 null)으로, 자기 현재 slug 는 사용 중으로 보지
   * 않는다.
   */
  private String resolveSlug(String requested, String name, Long excludeId) {
    String slug = requested == null ? "" : requested.trim();
    if (slug.isEmpty()) {
      return generateUniqueSlug(name, excludeId);
    }
    if (platformTenantRepository.slugExists(slug, excludeId)) {
      throw new IllegalArgumentException("이미 사용 중인 slug 입니다: " + slug);
    }
    return slug;
  }

  /**
   * 이름 기반 slug 를 전역 유일하게 만든다 — base 가 이미 쓰이면 "-2", "-3" … 순으로 suffix 를 올려 첫 빈 값을 채택. excludeId 테넌트
   * 자신의 slug 는 사용 중으로 보지 않아, 이름이 그대로면 slug 도 그대로 유지된다.
   *
   * <p>호출자 트랜잭션 안에서 실행되며 tenant.slug UNIQUE 제약이 최종 방어선이다(동시 경합 시 한쪽은 제약 위반으로 롤백). 운영자 콘솔 단일 사용
   * 시나리오라 재시도 루프는 두지 않는다.
   */
  private String generateUniqueSlug(String name, Long excludeId) {
    String base = slugify(name);
    for (int i = 1; ; i++) {
      String suffix = i == 1 ? "" : "-" + i;
      // tenant.slug VARCHAR(64) — 긴 이름에서 나온 base 는 suffix 자리를 남기고 자른다(끝 하이픈 제거).
      String head = base.substring(0, Math.min(base.length(), MAX_SLUG_LENGTH - suffix.length()));
      String candidate = head.replaceAll("-+$", "") + suffix;
      if (!platformTenantRepository.slugExists(candidate, excludeId)) {
        return candidate;
      }
    }
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

  /**
   * 테넌트 이름·slug 수정 후 갱신된 상세를 반환한다(WP-336).
   *
   * <p>slug 를 비우면 이름에서 자동 생성하고(생성과 동일), 지정했으면 자기 자신을 제외한 다른 테넌트와 겹칠 때 400. 없는 테넌트면 404.
   *
   * <p>삭제됨·영구 삭제 중인 테넌트는 409(WP-341) — 영구 삭제 확인이 테넌트 이름을 대조하므로 그 사이 이름이 바뀌면 안 되고, 삭제된 테넌트는 복원 전까지
   * 편집 대상이 아니다. slug 중복 검사보다 먼저 막아 상태 충돌을 우선 알린다.
   */
  @Transactional
  public TenantDetailResponse updateTenant(Long id, UpdateTenantRequest req) {
    requireLive(id);
    String name = req.name().trim();
    String slug = resolveSlug(req.slug(), name, id);
    if (platformTenantRepository.updateInfo(id, name, slug) == 0) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + id);
    }
    return getTenant(id);
  }

  /** 기본 테넌트면 409 — 삭제되면 신규 가입자가 접근할 수 없는 테넌트에 귀속된다. */
  private static void rejectDefaultTenant(Long id) {
    if (id == DefaultTenant.ID) {
      throw new TenantStateConflictException("기본 테넌트는 삭제할 수 없습니다.");
    }
  }

  /** 현재 상태를 반환한다 — 없는 테넌트면 404(PlatformTenantNotFoundException). */
  private String statusOrThrow(Long id) {
    return platformTenantRepository
        .findStatus(id)
        .orElseThrow(() -> new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + id));
  }

  /** 조건부 전환 공통 — 0행이면 존재 여부로 404(테넌트 없음)/409(상태 불일치)를 가른다. */
  private void transitionOrThrow(Long id, Collection<String> from, String to, String conflictMsg) {
    if (platformTenantRepository.transition(id, from, to) == 0) {
      statusOrThrow(id); // 없으면 404, 있으면 상태 불일치 409
      throw new TenantStateConflictException(conflictMsg);
    }
    // 전환 UPDATE 는 이 메서드가 트랜잭션 밖이라 이미 커밋됐다 — 무효화 후 첫 조회가 새 상태를 읽는다.
    tenantStatusChecker.invalidate(id);
  }

  /** 테넌트 정지 — ACTIVE 에서만(삭제된 테넌트는 409). */
  public void suspend(Long id) {
    transitionOrThrow(id, List.of("ACTIVE"), "SUSPENDED", "활성 상태의 테넌트만 정지할 수 있습니다.");
  }

  /** 테넌트 활성화 — SUSPENDED 에서만(삭제된 테넌트는 복원을 써야 한다). */
  public void activate(Long id) {
    transitionOrThrow(id, List.of("SUSPENDED"), "ACTIVE", "정지된 테넌트만 활성화할 수 있습니다.");
  }

  /** 테넌트 삭제 — ACTIVE/SUSPENDED → DELETED. 데이터는 남고 구성원 접근만 막힌다(복원 가능). */
  public void delete(Long id) {
    rejectDefaultTenant(id);
    transitionOrThrow(id, LIVE, "DELETED", "이미 삭제된 테넌트입니다.");
  }

  /** 삭제된 테넌트 복원 — DELETED → ACTIVE. 영구 삭제 진행 중(PURGING)이면 409. */
  public void restore(Long id) {
    transitionOrThrow(id, List.of("DELETED"), "ACTIVE", "삭제된 테넌트만 복원할 수 있습니다.");
  }

  /**
   * 영구 삭제 요청 — 이름 확인 후 DELETED → PURGING. 실제 삭제는 TenantPurgeJob 이 비동기로 수행한다.
   *
   * <p>이름 비교는 입력·저장명 모두 앞뒤 공백을 무시하고 대소문자는 구분한다(콘솔 입력 검증과 동일). 불일치는 400(IllegalArgumentException).
   */
  public void requestPurge(Long id, String confirmName) {
    rejectDefaultTenant(id);
    String confirm = confirmName == null ? "" : confirmName.trim();
    // 상태·이름 검사와 전환을 한 UPDATE 로 원자 처리한다(조회 후 전환 사이의 경합 제거).
    if (platformTenantRepository.requestPurge(id, confirm) == 0) {
      if (!"DELETED".equals(statusOrThrow(id))) {
        throw new TenantStateConflictException("삭제된 테넌트만 영구 삭제할 수 있습니다.");
      }
      throw new IllegalArgumentException("테넌트 이름이 일치하지 않습니다.");
    }
    tenantStatusChecker.invalidate(id);
  }

  /** 편집(멤버 추가·쿼터) 가드 — 없으면 404, 삭제·영구 삭제 중인 테넌트는 409. */
  private void requireLive(Long id) {
    if (!LIVE.contains(statusOrThrow(id))) {
      throw new TenantStateConflictException("삭제된 테넌트는 변경할 수 없습니다.");
    }
  }

  /**
   * 테넌트 드라이브 한도 변경 후 갱신된 상세를 반환한다(#81).
   *
   * <p>없는 테넌트 id 이면 PlatformTenantNotFoundException(404).
   */
  @Transactional
  public TenantDetailResponse updateQuota(Long id, long quotaBytes) {
    // 삭제·영구 삭제 중인 테넌트는 한도를 바꿀 수 없다(없으면 404).
    requireLive(id);
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
    // 대상 테넌트가 존재하고(없으면 404) 삭제되지 않았어야 한다(삭제·영구 삭제 중이면 409).
    requireLive(tenantId);
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
    // 대상 테넌트가 존재하고(없으면 404) 삭제되지 않았어야 한다(삭제·영구 삭제 중이면 409).
    requireLive(tenantId);
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

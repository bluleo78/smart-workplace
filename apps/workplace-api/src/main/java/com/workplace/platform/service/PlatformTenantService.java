package com.workplace.platform.service;

import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.dto.TenantMemberResponse;
import com.workplace.platform.dto.TenantSummaryResponse;
import com.workplace.platform.exception.PlatformTenantNotFoundException;
import com.workplace.platform.repository.PlatformTenantRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
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
    // 초기 소유자는 기존 사용자여야 한다(없으면 400).
    if (!userRepository.existsById(req.ownerUserId())) {
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

  /** 테넌트 멤버 목록 — 테넌트가 없으면 404. */
  public List<TenantMemberResponse> getMembers(Long tenantId) {
    if (platformTenantRepository.findTenant(tenantId).isEmpty()) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + tenantId);
    }
    return platformTenantRepository.findMembers(tenantId);
  }
}

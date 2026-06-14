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

/**
 * 운영자 콘솔 — 테넌트 생성/목록/상세/정지/활성화/멤버 조회.
 *
 * <p>⚠️ 이 서비스에는 {@code @Transactional} 을 붙이지 않는다. 생성은 {@link
 * PlatformTenantRepository#createTenantWithOwner} (별도 빈, 자체 트랜잭션)에서 커밋된 뒤 반환되어야 하고, 후속 단계(Task 6 역할
 * 시드)가 커밋된 tenant 행을 별도 커넥션에서 봐야 하기 때문이다. 서비스에 트랜잭션을 걸면 self-invocation 프록시 우회와 커밋 지연이 생긴다.
 */
@Service
@RequiredArgsConstructor
public class PlatformTenantService {

  private final PlatformTenantRepository platformTenantRepository;
  private final UserRepository userRepository;

  /** 테넌트 생성 — slug 중복·owner 존재 검증 후 tenant + OWNER 멤버십 생성(커밋). 생성된 상세를 반환. */
  public TenantDetailResponse createTenant(CreateTenantRequest req) {
    // slug 가 지정된 경우 전역 유일성 검증(중복이면 400).
    if (req.slug() != null && platformTenantRepository.slugExists(req.slug())) {
      throw new IllegalArgumentException("이미 사용 중인 slug 입니다: " + req.slug());
    }
    // 초기 소유자는 기존 사용자여야 한다(없으면 400).
    if (!userRepository.existsById(req.ownerUserId())) {
      throw new IllegalArgumentException("존재하지 않는 사용자입니다: " + req.ownerUserId());
    }
    Long tenantId =
        platformTenantRepository.createTenantWithOwner(req.name(), req.slug(), req.ownerUserId());
    // 방금 커밋된 테넌트를 다시 조회해 일관된 상세(멤버 수 포함)를 반환.
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

  /** 테넌트 멤버 목록 — 테넌트가 없으면 404. */
  public List<TenantMemberResponse> getMembers(Long tenantId) {
    if (platformTenantRepository.findTenant(tenantId).isEmpty()) {
      throw new PlatformTenantNotFoundException("테넌트를 찾을 수 없습니다: " + tenantId);
    }
    return platformTenantRepository.findMembers(tenantId);
  }
}

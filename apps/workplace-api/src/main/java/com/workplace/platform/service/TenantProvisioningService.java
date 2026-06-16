package com.workplace.platform.service;

import com.workplace.platform.repository.PlatformTenantRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 신규 테넌트의 기본 RBAC(ADMIN/USER 역할 + 권한 + 초기 Owner 할당)를 시드한다.
 *
 * <p>⚠️ {@code @Transactional} 을 붙이지 않는다 — 반드시 호출자({@code createTenant})의 트랜잭션에 합류해야 한다. 그래야 role 의
 * tenant_id FK 가 같은 트랜잭션의 미커밋 tenant 행을 보고(Postgres FK 는 자기 스냅샷 기준), RLS WITH CHECK(tenant_id=GUC)도
 * 트랜잭션-로컬 GUC 로 통과한다. 별도 트랜잭션(REQUIRES_NEW)/별도 커넥션을 쓰면 둘 다 깨진다.
 */
@Service
@RequiredArgsConstructor
public class TenantProvisioningService {

  private final PlatformTenantRepository platformTenantRepository;

  /**
   * USER 역할에 부여할 permission code 목록 — V2{@code __init_identity.sql} 의 USER 시드와 동일(self 프로필 권한만).
   *
   * <p>주의: tenant#1(과도기 테넌트)의 USER 역할은 이후 마이그레이션(V6 {@code project:manage}, V33 {@code
   * contact:write})으로 권한이 추가됐다. 여기서는 의도적으로 V2 기준만 시드하므로, 신규 테넌트의 USER 는 tenant#1 보다 약하다(설계 결정 — 운영자
   * 콘솔 보고서의 우려사항 참조).
   */
  private static final List<String> USER_ROLE_PERMISSION_CODES =
      List.of("user:read:self", "user:write:self");

  /**
   * AGENT 역할(개인 비서 기본 역할)에 부여할 permission code — USER 의 비-관리 업무 권한에서 {@code project:manage}(프로젝트
   * 삭제·멤버관리·스키마변경)만 제외한 12개. (#278) 업무별 에이전트는 관리자가 별도 역할을 부여한다.
   *
   * <p>마이그레이션 V75 의 시드 코드 집합과 동일하게 유지해야 한다.
   */
  private static final List<String> AGENT_ROLE_PERMISSION_CODES =
      List.of(
          "project:read",
          "project:write",
          "issue:write",
          "label:manage",
          "savedview:manage",
          "cycle:manage",
          "contact:read",
          "contact:write",
          "calendar:read",
          "calendar:write",
          "user:read:self",
          "user:write:self");

  /**
   * 신규 테넌트의 기본 RBAC 를 현재 트랜잭션 안에서 시드한다.
   *
   * @param tenantId 신규 테넌트 id (이미 같은 트랜잭션에 INSERT 됨, 미커밋)
   * @param ownerUserId 초기 소유자 — 테넌트 ADMIN 역할을 부여받는다
   */
  public void seedDefaultRoles(Long tenantId, Long ownerUserId) {
    // 트랜잭션-로컬 GUC 를 신규 테넌트로 → 이후 role/role_permission/user_role INSERT 가 RLS·DEFAULT 충전을 통과.
    platformTenantRepository.setTenantGuc(tenantId);
    try {
      Long adminRoleId = platformTenantRepository.insertRole("ADMIN", "테넌트 관리자", true);
      Long userRoleId = platformTenantRepository.insertRole("USER", "일반 사용자", true);
      // AGENT = AI 에이전트(개인 비서) 기본 역할. (#278)
      Long agentRoleId = platformTenantRepository.insertRole("AGENT", "AI 에이전트(개인 비서)", true);
      // ADMIN = 전체 권한, USER = V2 기준 self 권한만, AGENT = 비-관리 업무 권한 12개.
      platformTenantRepository.grantAllPermissions(adminRoleId);
      platformTenantRepository.grantPermissionsByCode(userRoleId, USER_ROLE_PERMISSION_CODES);
      platformTenantRepository.grantPermissionsByCode(agentRoleId, AGENT_ROLE_PERMISSION_CODES);
      // 초기 Owner 가 테넌트를 실제로 사용할 수 있도록 ADMIN 역할 할당.
      platformTenantRepository.assignUserRole(ownerUserId, adminRoleId);
    } finally {
      // 같은 tx 의 후속 작업(findTenant 등)이 시드 GUC 를 물려받지 않게 빈 문자열로 리셋.
      platformTenantRepository.clearTenantGuc();
    }
  }
}

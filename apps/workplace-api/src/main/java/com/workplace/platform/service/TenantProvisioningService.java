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
   * USER 역할(일반 구성원)에 부여할 permission code — tenant#1 USER 가 마이그레이션(V2·V6·V31·V33·V120·V132 등)으로 누적한
   * 업무 권한 집합과 동일하다.
   *
   * <p>WP-104: 예전에는 V2 기준 self 권한만 시드해서 신규 테넌트의 일반 구성원은 연락처·프로젝트·이슈·캘린더 API 가 전부 403 이었다. 일반 구성원이
   * 실제로 일할 수 있어야 하므로 tenant#1 USER 와 같은 집합을 준다. 기존 테넌트는 V139 가 보충한다. 계정 관리 권한({@code
   * user:read}/{@code user:write}/{@code role:assign})은 그대로 ADMIN 전용이다.
   *
   * <p>USER 에 권한을 추가하는 마이그레이션을 쓸 때는 이 목록도 함께 갱신해야 한다 — {@code NewTenantProvisioningTest} 가 tenant#1
   * USER 와의 집합 일치를 검증한다.
   */
  private static final List<String> USER_ROLE_PERMISSION_CODES =
      List.of(
          "project:read",
          "project:write",
          "project:manage",
          "issue:write",
          "label:manage",
          "savedview:manage",
          "cycle:manage",
          "milestone:manage",
          "contact:read",
          "contact:write",
          "calendar:read",
          "calendar:write",
          "member:read",
          "user:read:self",
          "user:write:self");

  /**
   * AGENT 역할(개인 비서 기본 역할)에 부여할 permission code — USER 의 업무 권한에서 관리성 권한({@code project:manage} 프로젝트
   * 삭제·멤버관리·스키마변경, {@code milestone:manage})을 뺀 집합 (#278) + 구성원 디렉터리 조회 {@code member:read} (#833).
   * 업무별 에이전트는 관리자가 별도 역할을 부여한다. AI 에게 주는 권한이라 USER 에서 파생하지 않고 명시 목록으로 둔다 — USER 에 권한이 늘어도 AGENT 로
   * 자동 전파되지 않게 하기 위함.
   *
   * <p>{@code member:read} 는 AI 가 사람 이름으로 구성원을 찾아 userId 를 확정하는 경로(search_members)에 필요하다. 이것이 없으면
   * 연락처 목록이 유일한 사람 검색 경로가 되어 연락처 id 를 userId 로 오용하게 된다. 조회 전용이며, 역할변경·활성토글은 확인 카드가 사람의 권한으로 실행하므로
   * AGENT 에 쓰기 권한을 주지 않는다.
   *
   * <p>마이그레이션 V75 + V132 의 시드 코드 집합과 동일하게 유지해야 한다 — {@code NewTenantProvisioningTest} 가 tenant#1
   * AGENT 와의 집합 일치를 검증한다.
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
          "member:read",
          "user:read:self",
          "user:write:self");

  /**
   * 신규 테넌트의 기본 RBAC 를 현재 트랜잭션 안에서 시드한다.
   *
   * @param tenantId 신규 테넌트 id (이미 같은 트랜잭션에 INSERT 됨, 미커밋)
   * @param ownerUserId 초기 소유자 — 테넌트 ADMIN 역할을 부여받는다. null 이면 소유자 없는 테넌트이므로 역할(ADMIN/USER/AGENT)만
   *     시드하고 소유자 ADMIN 할당은 건너뛴다. 이렇게 해도 ADMIN/USER/AGENT 역할은 존재하므로 이후 멤버 추가(#497)가 찾아 쓸 수 있다.
   */
  public void seedDefaultRoles(Long tenantId, Long ownerUserId) {
    // 트랜잭션-로컬 GUC 를 신규 테넌트로 → 이후 role/role_permission/user_role INSERT 가 RLS·DEFAULT 충전을 통과.
    platformTenantRepository.setTenantGuc(tenantId);
    try {
      Long adminRoleId = platformTenantRepository.insertRole("ADMIN", "테넌트 관리자", true);
      Long userRoleId = platformTenantRepository.insertRole("USER", "일반 사용자", true);
      // AGENT = AI 에이전트(개인 비서) 기본 역할. (#278)
      Long agentRoleId = platformTenantRepository.insertRole("AGENT", "AI 에이전트(개인 비서)", true);
      // ADMIN = 전체 권한, USER = tenant#1 USER 와 같은 업무 권한(WP-104), AGENT = 비-관리 업무 권한.
      platformTenantRepository.grantAllPermissions(adminRoleId);
      platformTenantRepository.grantPermissionsByCode(userRoleId, USER_ROLE_PERMISSION_CODES);
      platformTenantRepository.grantPermissionsByCode(agentRoleId, AGENT_ROLE_PERMISSION_CODES);
      // 초기 Owner 가 테넌트를 실제로 사용할 수 있도록 ADMIN 역할 할당(소유자 미지정 시 건너뜀).
      if (ownerUserId != null) {
        platformTenantRepository.assignUserRole(ownerUserId, adminRoleId);
      }
    } finally {
      // 같은 tx 의 후속 작업(findTenant 등)이 시드 GUC 를 물려받지 않게 빈 문자열로 리셋.
      platformTenantRepository.clearTenantGuc();
    }
  }
}

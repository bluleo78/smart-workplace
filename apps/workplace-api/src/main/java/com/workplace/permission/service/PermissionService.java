package com.workplace.permission.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.repository.PermissionRepository;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class PermissionService {

  /**
   * 역할과 무관하게 현재 테넌트의 ACTIVE 멤버라면 누구나 갖는 기본 권한(#861).
   *
   * <p>구성원 디렉터리 조회는 "이 워크스페이스에 누가 있는가"라 멤버라면 누구나 볼 수 있어야 한다(V132 원칙). V132 는 이를 기존 역할에 일괄 부여하는 방식으로
   * 풀었지만, 역할 없이 생성되는 채널 에이전트(/admin/agents)는 어떤 역할에도 속하지 않아 여전히 403 을 받았다 — 그래서 username
   * 해석(open_dm·search_members)이 실패했다. 역할 부여는 관리자의 의도적 선택이므로 에이전트에 역할을 자동으로 주지 않고, 조회 전용인 이 권한만 멤버십
   * 기준으로 보장한다.
   */
  static final Set<String> MEMBER_BASELINE_PERMISSIONS = Set.of("member:read");

  private final PermissionRepository permissionRepository;

  @Transactional(readOnly = true)
  public List<PermissionResponse> getAllPermissions() {
    return permissionRepository.findAll();
  }

  @Transactional(readOnly = true)
  public List<PermissionResponse> getPermissionsByCategory(String category) {
    return permissionRepository.findByCategory(category);
  }

  /**
   * 사용자의 유효 권한 = 역할 경유 권한 ∪ (현재 테넌트 ACTIVE 멤버면) 멤버 기본 권한.
   *
   * <p>테넌트 컨텍스트가 없거나 멤버십이 ACTIVE 가 아니면 기본 권한을 붙이지 않는다(fail-closed).
   */
  @Transactional(readOnly = true)
  public Set<String> getUserPermissions(Long userId) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return permissionRepository.findPermissionCodesByUserId(userId);
    return permissionRepository.findEffectivePermissionCodes(
        userId, tenantId, MEMBER_BASELINE_PERMISSIONS);
  }
}

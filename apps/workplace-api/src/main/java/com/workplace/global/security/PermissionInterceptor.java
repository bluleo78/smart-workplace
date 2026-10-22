package com.workplace.global.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.lang.NonNull;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
@RequiredArgsConstructor
public class PermissionInterceptor implements HandlerInterceptor {

  // WP-729: ADMIN 전용 API 판정용. 컨트롤러 슬라이스 테스트(@WebMvcTest)엔 서비스 빈이 없어 지연 조회한다 — 없으면 ADMIN 전용 API 는
  // 막는다.
  private final ObjectProvider<PermissionChecker> permissionChecker;

  @Override
  public boolean preHandle(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull Object handler) {
    // Skip permission check on async dispatch (e.g., SseEmitter completion)
    if (request.getDispatcherType() == jakarta.servlet.DispatcherType.ASYNC) {
      return true;
    }

    if (!(handler instanceof HandlerMethod handlerMethod)) {
      return true;
    }

    RequirePermission methodAnnotation = handlerMethod.getMethodAnnotation(RequirePermission.class);
    RequirePermission classAnnotation =
        handlerMethod.getBeanType().getAnnotation(RequirePermission.class);

    RequirePermission annotation = methodAnnotation != null ? methodAnnotation : classAnnotation;
    boolean adminOnly =
        handlerMethod.hasMethodAnnotation(RequireAdmin.class)
            || handlerMethod.getBeanType().isAnnotationPresent(RequireAdmin.class);
    boolean webSessionOnly =
        handlerMethod.hasMethodAnnotation(RequireWebSession.class)
            || handlerMethod.getBeanType().isAnnotationPresent(RequireWebSession.class);
    if (annotation == null && !adminOnly && !webSessionOnly) {
      return true;
    }

    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || !authentication.isAuthenticated()) {
      throw new AccessDeniedException("로그인이 필요합니다");
    }

    if (annotation != null) {
      requirePermissions(authentication, annotation);
    }
    // WP-729: ADMIN 전용 API — 역할은 요청 권한(authority)에 실리지 않으므로 DB 에서 지금 워크스페이스의 역할로 판정한다.
    if (adminOnly
        && !(authentication.getPrincipal() instanceof Long userId
            && permissionChecker.getIfAvailable() instanceof PermissionChecker checker
            && checker.userHasRole(userId, "ADMIN"))) {
      throw new AccessDeniedException("관리자만 할 수 있는 작업입니다");
    }
    // WP-845: 권한·자격 증명을 새로 만드는 관리 동작은 웹 로그인 세션에서만 — 권한 확인 뒤에 판정해 권한 없는 호출은 그대로 권한 오류를 받는다.
    if (webSessionOnly) {
      AuthDetails.requireWebSession(authentication);
    }

    return true;
  }

  /** {@link RequirePermission} 에 적힌 권한을 요청 권한(authority)이 모두 갖는지 확인한다. */
  private static void requirePermissions(
      Authentication authentication, RequirePermission annotation) {

    Set<String> userPermissions =
        authentication.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toSet());

    for (String requiredPermission : annotation.value()) {
      if (!userPermissions.contains(requiredPermission)) {
        throw new AccessDeniedException("이 작업을 할 권한이 없습니다 (필요 권한: " + requiredPermission + ")");
      }
    }
  }
}

package com.workplace.global.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * AI 키({@code ak_})로 인증한 호출만 부를 수 있는 API 표시(WP-1286). {@link PermissionInterceptor} 가 판정하고, 아니면
 * {@link AgentOnlyException}(403 {@code AGENT_ONLY})을 던진다.
 *
 * <p>메서드마다 직접 검사하면 새 API 에서 한 줄을 빠뜨려도 사람 토큰으로 열리고 컴파일·테스트가 잡지 못한다. 표시로 모으고 {@code
 * AgentOnlyApiArchTest} 가 {@code /api/v1/agent-runtime/me} 아래 컨트롤러에 표시가 있는지 검사한다.
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireAgent {}

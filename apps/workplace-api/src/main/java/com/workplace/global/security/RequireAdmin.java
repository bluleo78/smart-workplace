package com.workplace.global.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 워크스페이스 ADMIN 역할을 가진 사람만 부를 수 있는 API 표시(WP-729). {@link PermissionInterceptor} 가 {@link
 * RequirePermission} 확인 뒤에 판정한다.
 *
 * <p>권한 코드 하나로는 막을 수 없는 일에 쓴다 — 예: AI 키 발급은 그 AI 의 멤버십 전체로 행동할 수 있게 하므로, 「사용자 쓰기」만 받은 구성원이 자기가 못 보는
 * 비공개 프로젝트를 AI 를 통해 열 수 있었다.
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireAdmin {}

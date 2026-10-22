package com.workplace.global.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 웹 로그인 세션(브라우저 JWT)에서만 부를 수 있는 API 표시(WP-845). {@link PermissionInterceptor} 가 판정한다 — PAT·AI
 * 키·Internal 인증은 {@link AuthDetails} 가 없어 403.
 *
 * <p>권한이나 PAT 보다 오래 가는 자격 증명(비밀번호 계정·역할·AI 키·LLM 자격 증명)을 새로 만드는 관리 동작에 붙인다. PAT 로 이런 것을 만들 수 있으면,
 * 새어 나간 PAT 를 회수해도 그 PAT 로 만든 계정·키로 계속 접근된다(WP-597 과 같은 기준).
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireWebSession {}

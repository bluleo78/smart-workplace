package com.workplace.home.dto;

/**
 * 앱 링크 판정 설정(WP-1165).
 *
 * @param appHost 공개 웹 주소의 호스트(소문자, 포트 제외). 설정이 비었거나 잘못됐으면 null — 웹은 지금 접속한 호스트만 본다.
 */
public record AppLinkConfig(String appHost) {}

package com.workplace.auth.dto;

/**
 * 공개 셀프 회원가입 가용성 응답.
 *
 * <p>웹 가입 화면이 폼 노출 여부를 판단하기 위해 사용한다(부트스트랩 이후에는 false).
 */
public record SignupAvailableResponse(boolean available) {}

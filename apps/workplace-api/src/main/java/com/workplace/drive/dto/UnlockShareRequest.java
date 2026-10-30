package com.workplace.drive.dto;

/** 공유 링크 비밀번호 확인 요청(POST /share/{token}/unlock, WP-1227). 본문이라 한글 비밀번호도 인코딩 없이 그대로 보낸다. */
public record UnlockShareRequest(String password) {}

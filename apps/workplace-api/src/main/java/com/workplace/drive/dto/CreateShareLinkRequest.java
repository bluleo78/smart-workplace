package com.workplace.drive.dto;

import java.time.Instant;

/** 공유 링크 생성 요청. audience=EXTERNAL|INTERNAL, password/expiresAt 선택. */
public record CreateShareLinkRequest(String audience, String password, Instant expiresAt) {}

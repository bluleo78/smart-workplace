package com.workplace.auth.dto;

import com.workplace.tenant.dto.MembershipResponse;
import java.util.List;

/** 1단계 로그인 응답: tenant-less access 토큰 + 선택 가능한 테넌트 목록(refresh 는 쿠키). */
public record LoginResponse(
    String accessToken, String tokenType, long expiresIn, List<MembershipResponse> memberships) {}

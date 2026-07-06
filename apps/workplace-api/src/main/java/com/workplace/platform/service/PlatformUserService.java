package com.workplace.platform.service;

import com.workplace.platform.dto.PlatformUserLookupResponse;
import com.workplace.platform.repository.PlatformTenantRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 운영자 콘솔 — 전역 사용자(이메일) 조회. 기존 사용자를 다른 테넌트 멤버로 추가하는 흐름의 사전 확인에 쓰인다. */
@Service
@RequiredArgsConstructor
public class PlatformUserService {

  private final UserRepository userRepository;
  private final PlatformTenantRepository platformTenantRepository;

  /** 이메일(대소문자 무시)로 전역 사용자를 조회한다. 없으면 empty. */
  public Optional<PlatformUserLookupResponse> lookupByEmail(String email) {
    return userRepository
        .findByEmailIgnoreCase(email)
        .map(
            user ->
                new PlatformUserLookupResponse(
                    user.id(),
                    user.name(),
                    user.email(),
                    platformTenantRepository.isPlatformOperator(user.id())));
  }
}

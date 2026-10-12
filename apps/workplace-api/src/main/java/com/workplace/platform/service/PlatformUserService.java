package com.workplace.platform.service;

import com.workplace.platform.dto.PlatformUserLookupResponse;
import com.workplace.platform.dto.PlatformUserSearchItem;
import com.workplace.platform.repository.PlatformTenantRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 운영자 콘솔 — 전역 사용자 조회(이메일 정확일치)·자동완성 검색. */
@Service
@RequiredArgsConstructor
public class PlatformUserService {

  private final UserRepository userRepository;
  private final PlatformTenantRepository platformTenantRepository;

  /** 자동완성 검색어 최소 길이 — 한 글자는 후보가 너무 많아 의미가 없다. */
  private static final int MIN_QUERY_LENGTH = 2;

  /** 자동완성 결과 최대 건수(요청 limit 의 상한). */
  private static final int MAX_LIMIT = 50;

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

  /**
   * 소유자 선택 자동완성용 사용자 검색(WP-337). 앞뒤 공백을 걷은 검색어가 2글자 미만이면 DB 를 조회하지 않고 빈 목록을 준다. limit 은 1~50 으로
   * 보정한다.
   */
  public List<PlatformUserSearchItem> search(String q, int limit) {
    String trimmed = q == null ? "" : q.trim();
    if (trimmed.length() < MIN_QUERY_LENGTH) {
      return List.of();
    }
    return userRepository.searchActiveHumans(trimmed, Math.clamp(limit, 1, MAX_LIMIT)).stream()
        .map(u -> new PlatformUserSearchItem(u.id(), u.name(), u.username(), u.email()))
        .toList();
  }
}

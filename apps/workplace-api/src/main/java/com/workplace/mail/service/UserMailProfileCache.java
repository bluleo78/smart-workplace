package com.workplace.mail.service;

import com.workplace.mail.dto.UserMailProfile;
import java.util.HashMap;
import java.util.Map;

/**
 * 한 분석 배치(동기화 후 ④ 패스 · AI 켬 백필 · 본문 적재 직후 루프) 동안의 "나" 프로필 캐시(WP-150). 배치마다 새로 만들어 버린다 — 사용자 id 키 전역
 * 캐시는 쓰지 않는다(한 사용자가 테넌트마다 다른 계정·그룹을 가질 수 있고, 변경이 다음 배치에 바로 반영되게). 배치는 한 스레드에서 순서대로 돌므로 동기화하지 않는다.
 * 조회 예외는 캐시하지 않고 그대로 던진다.
 */
public final class UserMailProfileCache {

  private final UserMailProfileBuilder builder;
  private final Map<Long, UserMailProfile> byUser = new HashMap<>();

  UserMailProfileCache(UserMailProfileBuilder builder) {
    this.builder = builder;
  }

  /** 사용자의 프로필 — 이 배치에서 처음이면 조회한다. */
  public UserMailProfile get(long userId) {
    UserMailProfile p = byUser.get(userId);
    if (p == null) {
      p = builder.build(userId);
      byUser.put(userId, p);
    }
    return p;
  }
}

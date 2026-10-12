package com.workplace.global.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.tenant.repository.TenantRepository;
import org.junit.jupiter.api.Test;

/**
 * TenantStatusChecker 캐시 정책 단위 테스트 — ACTIVE 결과만 캐시하고 비활성 결과는 캐시하지 않는다.
 *
 * <p>다중 파드에서 다른 파드가 복원·활성화한 직후, 이 파드가 캐시한 "비활성"이 TTL 동안 남아 정상 사용자를 로그아웃시키는 것을 막기 위함이다.
 */
class TenantStatusCheckerTest {

  @Test
  void inactiveResult_isNotCached_soReactivationIsSeenImmediately() {
    TenantRepository repo = mock(TenantRepository.class);
    when(repo.isActive(7L)).thenReturn(false, true);
    TenantStatusChecker checker = new TenantStatusChecker(repo, 60_000);

    assertThat(checker.isActive(7L)).isFalse();
    // invalidate 없이도(다른 파드에서 활성화된 상황) 다음 호출이 바로 새 상태를 본다.
    assertThat(checker.isActive(7L)).isTrue();
  }

  @Test
  void activeResult_isCachedWithinTtl() {
    TenantRepository repo = mock(TenantRepository.class);
    when(repo.isActive(7L)).thenReturn(true);
    TenantStatusChecker checker = new TenantStatusChecker(repo, 60_000);

    assertThat(checker.isActive(7L)).isTrue();
    assertThat(checker.isActive(7L)).isTrue();
    verify(repo, times(1)).isActive(7L);
  }
}

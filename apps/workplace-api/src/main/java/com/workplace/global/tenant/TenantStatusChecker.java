package com.workplace.global.tenant;

import com.workplace.tenant.repository.TenantRepository;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 요청 경로에서 테넌트가 ACTIVE 인지 확인한다(WP-341 — 정지·삭제된 테넌트의 기존 토큰·내부 호출 즉시 차단).
 *
 * <p>매 요청 DB 조회를 피하려고 ACTIVE 결과만 짧은 TTL(기본 5초)로 캐시하고, 운영자 상태 전환 시 {@link #invalidate} 로 즉시 비운다. 비활성
 * 결과는 캐시하지 않고 매번 재조회한다 — 다중 파드에서 다른 파드가 복원·활성화한 직후 이 파드의 "비활성" 캐시가 정상 사용자를 TTL 동안 로그아웃시키는 것을 막기
 * 위함이다(비활성 테넌트의 요청은 어차피 차단되는 경로라 재조회 비용이 낮다). 반대로 정지·삭제가 다른 파드에서 일어난 경우엔 이 파드가 최대 TTL 동안 ACTIVE 로 볼
 * 수 있다(허용된 지연).
 */
@Component
public class TenantStatusChecker {

  private final TenantRepository tenantRepository;

  /** 캐시 TTL(ms) — 테스트 프로파일은 0(트랜잭션 테스트가 상태를 바꿨다 롤백해도 다른 테스트에 캐시가 새지 않게). 0 이하면 캐시하지 않는다. */
  private final long ttlMs;

  /** tenantId → 캐시 항목. */
  private final Map<Long, Entry> cache = new ConcurrentHashMap<>();

  /** 캐시 항목 — ACTIVE 로 확인된 결과의 만료 시각(epoch ms). */
  private record Entry(long expiresAt) {}

  public TenantStatusChecker(
      TenantRepository tenantRepository,
      @Value("${workplace.tenant-status-cache-ttl-ms:5000}") long ttlMs) {
    this.tenantRepository = tenantRepository;
    this.ttlMs = ttlMs;
  }

  /**
   * 테넌트가 존재하고 ACTIVE 인지 — ACTIVE 캐시가 살아 있으면 true, 아니면 tenant 테이블(RLS 비대상)을 조회한다(ACTIVE 일 때만 캐시).
   */
  public boolean isActive(long tenantId) {
    long now = System.currentTimeMillis();
    Entry hit = cache.get(tenantId);
    if (hit != null && hit.expiresAt() > now) {
      return true;
    }
    boolean active = tenantRepository.isActive(tenantId);
    if (active && ttlMs > 0) {
      cache.put(tenantId, new Entry(now + ttlMs));
    } else {
      cache.remove(tenantId);
    }
    return active;
  }

  /** 운영자 상태 전환 직후 호출 — 이 파드의 캐시를 비워 다음 요청부터 바로 새 상태를 보게 한다. */
  public void invalidate(long tenantId) {
    cache.remove(tenantId);
  }
}

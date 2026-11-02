package com.workplace.agentruntime.screen;

import com.workplace.global.util.CapabilityTokens;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 작업 화면 접속 표 보관소(WP-1277) — 브라우저 WebSocket 은 Authorization 헤더를 실을 수 없어, 로그인한 관리자가 POST 로 받은 일회용 표를
 * 쿼리에 실어 연결한다. 표는 메모리에만 두고(API 한 대 전제) 평문이 아닌 SHA-256 해시를 키로 둔다 — 힙 덤프·로그로 평문이 새지 않게.
 *
 * <p>표는 한 번 쓰면 사라지고({@link #consume}), 만료(30초)가 지나면 받지 않는다. 만료된 표는 {@link #removeExpired} 가 치운다.
 */
@Component
public class AgentScreenTickets {

  /** 표가 묶인 것 — 세션·테넌트·연 관리자. 연결은 이 값으로만 인증된다. */
  public record Claims(UUID sessionId, long tenantId, long adminUserId, Instant expiresAt) {}

  private final Map<String, Claims> byHash = new ConcurrentHashMap<>();

  /** 새 표를 만들어 보관하고 평문을 돌려준다(32바이트 난수, URL 에 안전한 Base64). */
  public String issue(Claims claims) {
    String plaintext = CapabilityTokens.generateUrlSafe(32);
    byHash.put(CapabilityTokens.sha256Hex(plaintext), claims);
    return plaintext;
  }

  /** 표를 꺼내며 지운다(일회용). 없거나 만료됐으면 빈 값. */
  public Optional<Claims> consume(String plaintext, Instant now) {
    if (plaintext == null || plaintext.isBlank()) return Optional.empty();
    Claims c = byHash.remove(CapabilityTokens.sha256Hex(plaintext));
    if (c == null || !now.isBefore(c.expiresAt())) return Optional.empty();
    return Optional.of(c);
  }

  /** 만료된 표를 지운다. */
  public void removeExpired(Instant now) {
    byHash.values().removeIf(c -> !now.isBefore(c.expiresAt()));
  }

  /** 세션이 닫히면 남은 표도 지운다 — 닫힌 세션으로 다시 붙지 않게. */
  public void removeForSession(UUID sessionId) {
    byHash.values().removeIf(c -> c.sessionId().equals(sessionId));
  }
}

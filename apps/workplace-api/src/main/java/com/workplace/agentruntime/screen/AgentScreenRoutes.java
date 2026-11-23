package com.workplace.agentruntime.screen;

import java.time.Duration;
import java.util.Collection;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * AI 작업 화면의 공유 경로 저장소(WP-1978) — 여러 api 파드가 같은 화면의 주인 파드·접속 표·입력 중 상태·화면 수 상한을 같은 곳에서 본다.
 *
 * <p>운영 구현은 {@link JooqAgentScreenRoutes}(DB 표 agent_screen_route). 모든 「살아 있음」 판정은 임대(lease_until)가
 * 지나지 않은 행만 센다 — 파드가 죽어 남은 행이 상한·입력 판정을 막지 않게 한다.
 */
public interface AgentScreenRoutes {

  /** 임대 길이 — 주인 파드가 이보다 짧은 주기로 갱신한다. */
  Duration LEASE = Duration.ofSeconds(90);

  /** 공유되는 화면 한 건의 경로 정보(접속 표·임대·입력 상태는 저장소 안에서만 다룬다). */
  record Route(
      UUID sessionId,
      long tenantId,
      long agentUserId,
      long locationId,
      long openedBy,
      String ownerPodId,
      String ownerAddr) {}

  /**
   * 그 AI 의 임대 지난 행을 지우고, 살아 있는 행이 maxPerAgent 미만이면 행을 넣고 true(임대 = DB now()+LEASE, 표 만료 = DB
   * now()+ticketTtl — 표 판정이 DB 시계로 하므로 만료도 DB 시계로 적는다).
   */
  boolean reserve(Route route, String ticketHash, Duration ticketTtl, int maxPerAgent);

  /** 해시가 맞고 표·임대가 살아 있으면 표를 지우며(NULL) 그 행을 돌려준다 — 한 번만. */
  Optional<Route> consumeTicket(String ticketHash);

  /** 임대가 살아 있는 행. */
  Optional<Route> find(UUID sessionId);

  /**
   * 같은 tenant·agent 의 다른 살아 있는 행이 input_holder 면 false. 아니면 이 행(임대가 살아 있을 때만) input_holder=true 로
   * 하고 true — 이 행이 없거나 임대가 지났으면 false(표에 적히지 않은 입력을 열지 않게).
   */
  boolean claimInput(UUID sessionId, long tenantId, long agentUserId);

  /** 같은 tenant·agent 의 다른 살아 있는 행이 input_holder 인지. */
  boolean inputTakenByOther(UUID sessionId, long tenantId, long agentUserId);

  /** 이 화면의 입력 중 표시를 끈다. */
  void releaseInput(UUID sessionId);

  /** 이 파드의 ids 중 임대가 살아 있는 행을 now()+LEASE 로 늘리고, 행이 없거나 임대가 이미 지나 늘리지 못한 id 를 돌려준다. */
  Set<UUID> renew(String podId, Collection<UUID> ids);

  /** 화면이 닫히면 행을 지운다. */
  void remove(UUID sessionId);

  /** 파드 종료 때 그 파드의 행을 모두 지운다. */
  void removeByPod(String podId);
}

package com.workplace.agentaccount.repository;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT_BINDING;

import com.workplace.jooq.tables.records.AgentAccountBindingRecord;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * AI ↔ 계정 묶음(agent_account_binding) jOOQ 리포지토리(WP-1448). AI 하나는 계정 하나에만 묶이고, 계정 하나를 여러 AI 가 쓸 수 있다.
 * 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다.
 */
@Repository
@RequiredArgsConstructor
public class AgentAccountBindingRepository {

  private final DSLContext dsl;

  /**
   * 묶음 한 행 — 버전 이어받기 칸은 이관 백필로 묶였을 때만 있다(V274).
   *
   * @param versionIdOverride runner 버전으로 계속 쓸 옛 연결 id(없으면 null)
   * @param overrideSecretVersion 이어받기가 유효한 계정 secret_version(묶을 때의 값, 없으면 null)
   */
  public record Binding(
      long agentUserId, long accountId, Long versionIdOverride, Long overrideSecretVersion) {}

  /**
   * AI 를 계정에 묶는다 — 이미 묶여 있으면 모두 덮어쓴다. 버전 이어받기 칸은 이관 백필만 채우고, 그 밖의 묶기는 null 로 쓴다.
   *
   * @param versionIdOverride runner 버전으로 계속 쓸 옛 연결 id(백필), 아니면 null
   * @param overrideSecretVersion 묶을 때의 계정 secret_version(백필), 아니면 null
   */
  public void upsert(
      long agentUserId,
      long accountId,
      Long boundBy,
      Long versionIdOverride,
      Long overrideSecretVersion) {
    OffsetDateTime now = OffsetDateTime.now();
    dsl.insertInto(AGENT_ACCOUNT_BINDING)
        .set(AGENT_ACCOUNT_BINDING.AGENT_USER_ID, agentUserId)
        .set(AGENT_ACCOUNT_BINDING.ACCOUNT_ID, accountId)
        .set(AGENT_ACCOUNT_BINDING.BOUND_BY, boundBy)
        .set(AGENT_ACCOUNT_BINDING.BOUND_AT, now)
        .set(AGENT_ACCOUNT_BINDING.VERSION_ID_OVERRIDE, versionIdOverride)
        .set(AGENT_ACCOUNT_BINDING.OVERRIDE_SECRET_VERSION, overrideSecretVersion)
        .onConflict(AGENT_ACCOUNT_BINDING.TENANT_ID, AGENT_ACCOUNT_BINDING.AGENT_USER_ID)
        .doUpdate()
        .set(AGENT_ACCOUNT_BINDING.ACCOUNT_ID, accountId)
        .set(AGENT_ACCOUNT_BINDING.BOUND_BY, boundBy)
        .set(AGENT_ACCOUNT_BINDING.BOUND_AT, now)
        .set(AGENT_ACCOUNT_BINDING.VERSION_ID_OVERRIDE, versionIdOverride)
        .set(AGENT_ACCOUNT_BINDING.OVERRIDE_SECRET_VERSION, overrideSecretVersion)
        .execute();
  }

  /** AI 의 묶음 한 행(묶이지 않았으면 empty) — runner 버전 계산용으로 이어받기 칸까지 읽는다. */
  public Optional<Binding> findBinding(long agentUserId) {
    return dsl.selectFrom(AGENT_ACCOUNT_BINDING)
        .where(AGENT_ACCOUNT_BINDING.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(AgentAccountBindingRepository::toBinding);
  }

  /** 여러 AI 의 묶음 행을 한 쿼리로 — AI id → 행. 묶이지 않은 AI 는 빠진다. */
  public Map<Long, Binding> findBindings(Collection<Long> agentUserIds) {
    if (agentUserIds.isEmpty()) return Map.of();
    Map<Long, Binding> out = new HashMap<>();
    dsl.selectFrom(AGENT_ACCOUNT_BINDING)
        .where(AGENT_ACCOUNT_BINDING.AGENT_USER_ID.in(agentUserIds))
        .forEach(r -> out.put(r.getAgentUserId(), toBinding(r)));
    return out;
  }

  /** 레코드 → 묶음 행. 단건·여러 건 조회가 같이 쓴다(칸이 늘면 여기만 고친다). */
  private static Binding toBinding(AgentAccountBindingRecord r) {
    return new Binding(
        r.getAgentUserId(),
        r.getAccountId(),
        r.getVersionIdOverride(),
        r.getOverrideSecretVersion());
  }

  /** AI 의 묶음을 푼다. 지운 행 수(없으면 0). */
  public int delete(long agentUserId) {
    return dsl.deleteFrom(AGENT_ACCOUNT_BINDING)
        .where(AGENT_ACCOUNT_BINDING.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  /** AI 가 묶인 계정 id(묶이지 않았으면 empty). */
  public Optional<Long> findAccountId(long agentUserId) {
    return dsl.select(AGENT_ACCOUNT_BINDING.ACCOUNT_ID)
        .from(AGENT_ACCOUNT_BINDING)
        .where(AGENT_ACCOUNT_BINDING.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(AGENT_ACCOUNT_BINDING.ACCOUNT_ID);
  }

  /** 여러 AI 의 계정 id 를 한 쿼리로 — AI id → 계정 id. 묶이지 않은 AI 는 빠진다. */
  public Map<Long, Long> findAccountIds(Collection<Long> agentUserIds) {
    if (agentUserIds.isEmpty()) return Map.of();
    Map<Long, Long> out = new HashMap<>();
    dsl.select(AGENT_ACCOUNT_BINDING.AGENT_USER_ID, AGENT_ACCOUNT_BINDING.ACCOUNT_ID)
        .from(AGENT_ACCOUNT_BINDING)
        .where(AGENT_ACCOUNT_BINDING.AGENT_USER_ID.in(agentUserIds))
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  /** 계정별로 그 계정을 쓰는 AI id 목록 — 계정 id → AI id 들(AI id 오름차순). 쓰는 AI 가 없는 계정은 빠진다. */
  public Map<Long, List<Long>> findAgentsByAccounts(Collection<Long> accountIds) {
    if (accountIds.isEmpty()) return Map.of();
    Map<Long, List<Long>> out = new HashMap<>();
    dsl.select(AGENT_ACCOUNT_BINDING.ACCOUNT_ID, AGENT_ACCOUNT_BINDING.AGENT_USER_ID)
        .from(AGENT_ACCOUNT_BINDING)
        .where(AGENT_ACCOUNT_BINDING.ACCOUNT_ID.in(accountIds))
        .orderBy(AGENT_ACCOUNT_BINDING.AGENT_USER_ID)
        .forEach(r -> out.computeIfAbsent(r.value1(), k -> new ArrayList<>()).add(r.value2()));
    return out;
  }

  /** 계정을 쓰는 AI 가 하나라도 있는가 — 있으면 폐기를 거절하는 근거. */
  public boolean isInUse(long accountId) {
    return dsl.fetchExists(AGENT_ACCOUNT_BINDING, AGENT_ACCOUNT_BINDING.ACCOUNT_ID.eq(accountId));
  }
}

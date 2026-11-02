package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_REPO_CREDENTIAL;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 별 저장소 토큰(agent_repo_credential) 리포지토리(WP-1268). 평문은 다루지 않는다 — 서비스가 EncryptionService 로 암호화한 값만
 * 넣고 꺼낸다. 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다(애플리케이션은 tenant_id 를 넣지 않는다).
 *
 * <p>시각은 DB {@code now()}(트랜잭션 시작 시각) 대신 앱 시각으로 쓴다 — 한 트랜잭션 안에서 등록·폐기가 이어져도 repos 버전이 구별되게.
 */
@Repository
@RequiredArgsConstructor
public class AgentRepoCredentialRepository {

  /** 행 한 개(암호문 포함 — 서비스 안에서만 쓴다). */
  public record Row(
      long id,
      long agentUserId,
      String kind,
      String host,
      String encryptedToken,
      OffsetDateTime createdAt,
      OffsetDateTime lastUsedAt) {}

  private final DSLContext dsl;

  /** 활성 행 한 개를 새로 넣고 그 행을 돌려준다. */
  public Row insert(
      long agentUserId, String kind, String host, String encryptedToken, Long createdBy) {
    return dsl.insertInto(AGENT_REPO_CREDENTIAL)
        .set(AGENT_REPO_CREDENTIAL.AGENT_USER_ID, agentUserId)
        .set(AGENT_REPO_CREDENTIAL.KIND, kind)
        .set(AGENT_REPO_CREDENTIAL.HOST, host)
        .set(AGENT_REPO_CREDENTIAL.ENCRYPTED_TOKEN, encryptedToken)
        .set(AGENT_REPO_CREDENTIAL.CREATED_BY, createdBy)
        .set(AGENT_REPO_CREDENTIAL.CREATED_AT, OffsetDateTime.now())
        .returning()
        .fetchOne(r -> toRow(r));
  }

  /** 그 AI·host 의 활성 행을 폐기한다(없으면 0). 교체 전 호출. */
  public int revokeActive(long agentUserId, String host) {
    return dsl.update(AGENT_REPO_CREDENTIAL)
        .set(AGENT_REPO_CREDENTIAL.REVOKED_AT, OffsetDateTime.now())
        // 폐기도 버전을 올린다 — 새 번호를 받아 그 AI 의 max(change_seq) 가 바뀌게
        .set(
            AGENT_REPO_CREDENTIAL.CHANGE_SEQ,
            DSL.field("nextval('agent_repo_credential_change_seq')", Long.class))
        .where(AGENT_REPO_CREDENTIAL.AGENT_USER_ID.eq(agentUserId))
        .and(AGENT_REPO_CREDENTIAL.HOST.eq(host))
        .and(AGENT_REPO_CREDENTIAL.REVOKED_AT.isNull())
        .execute();
  }

  /** 그 AI 의 활성 행 하나를 id 로 폐기하고 폐기한 행(kind·host 용)을 돌려준다 — 없으면 empty. */
  public Optional<Row> revokeById(long agentUserId, long id) {
    return dsl.update(AGENT_REPO_CREDENTIAL)
        .set(AGENT_REPO_CREDENTIAL.REVOKED_AT, OffsetDateTime.now())
        // 폐기도 버전을 올린다 — 새 번호를 받아 그 AI 의 max(change_seq) 가 바뀌게
        .set(
            AGENT_REPO_CREDENTIAL.CHANGE_SEQ,
            DSL.field("nextval('agent_repo_credential_change_seq')", Long.class))
        .where(AGENT_REPO_CREDENTIAL.ID.eq(id))
        .and(AGENT_REPO_CREDENTIAL.AGENT_USER_ID.eq(agentUserId))
        .and(AGENT_REPO_CREDENTIAL.REVOKED_AT.isNull())
        .returning()
        .fetchOptional(r -> toRow(r));
  }

  /** 그 AI 의 활성 행들 — host 오름차순. */
  public List<Row> findActive(long agentUserId) {
    return dsl.selectFrom(AGENT_REPO_CREDENTIAL)
        .where(AGENT_REPO_CREDENTIAL.AGENT_USER_ID.eq(agentUserId))
        .and(AGENT_REPO_CREDENTIAL.REVOKED_AT.isNull())
        .orderBy(AGENT_REPO_CREDENTIAL.HOST)
        .fetch(r -> toRow(r));
  }

  /** runner 가 받아 간 때를 기록한다 — 「최근 사용」. */
  public void touchLastUsed(Collection<Long> ids) {
    if (ids.isEmpty()) return;
    dsl.update(AGENT_REPO_CREDENTIAL)
        .set(AGENT_REPO_CREDENTIAL.LAST_USED_AT, OffsetDateTime.now())
        .where(AGENT_REPO_CREDENTIAL.ID.in(ids))
        .execute();
  }

  /**
   * 여러 AI 의 repos 버전을 한 번에(AI 마다 쿼리하지 않는다) — 각 AI 의 모든 행(활성·폐기)에서 {@code max(change_seq)}. 넣기·폐기마다
   * 시퀀스에서 새 번호를 받으므로 등록·교체·폐기마다 반드시 오른다. 행이 없는 AI 는 빠진다(= 버전 null).
   */
  public Map<Long, Long> versionsByAgents(Collection<Long> agentUserIds) {
    if (agentUserIds.isEmpty()) return Map.of();
    Map<Long, Long> out = new HashMap<>();
    dsl.select(AGENT_REPO_CREDENTIAL.AGENT_USER_ID, DSL.max(AGENT_REPO_CREDENTIAL.CHANGE_SEQ))
        .from(AGENT_REPO_CREDENTIAL)
        .where(AGENT_REPO_CREDENTIAL.AGENT_USER_ID.in(agentUserIds))
        .groupBy(AGENT_REPO_CREDENTIAL.AGENT_USER_ID)
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  private static Row toRow(org.jooq.Record r) {
    return new Row(
        r.get(AGENT_REPO_CREDENTIAL.ID),
        r.get(AGENT_REPO_CREDENTIAL.AGENT_USER_ID),
        r.get(AGENT_REPO_CREDENTIAL.KIND),
        r.get(AGENT_REPO_CREDENTIAL.HOST),
        r.get(AGENT_REPO_CREDENTIAL.ENCRYPTED_TOKEN),
        r.get(AGENT_REPO_CREDENTIAL.CREATED_AT),
        r.get(AGENT_REPO_CREDENTIAL.LAST_USED_AT));
  }
}

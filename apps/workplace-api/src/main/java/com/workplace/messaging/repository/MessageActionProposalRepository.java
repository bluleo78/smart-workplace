package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE_ACTION_PROPOSAL;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** 채팅 L3 위임 제안(message_action_proposal) 영속. status 전이는 PENDING 일 때만 허용(멱등). */
@Repository
@RequiredArgsConstructor
public class MessageActionProposalRepository {

  private final DSLContext dsl;

  /**
   * 제안 1건을 나타내는 값 객체.
   *
   * <p>payloadJson 은 JSONB 컬럼의 문자열 표현. resolvedAt/resolvedBy 는 PENDING 상태에서는 null.
   */
  public record ProposalRow(
      long id,
      long messageId,
      long channelId,
      long proposedByUserId,
      String actionType,
      String payloadJson,
      String status,
      String resultIssueKey,
      Long resolvedBy,
      Instant resolvedAt,
      Instant createdAt) {}

  /**
   * PENDING 상태로 제안 INSERT. tenant_id 는 GUC(app.tenant_id) 기본값으로 채워진다.
   *
   * @return 생성된 제안 id
   */
  public long insert(
      long messageId,
      long channelId,
      long proposedByUserId,
      String actionType,
      String payloadJson) {
    return dsl.insertInto(MESSAGE_ACTION_PROPOSAL)
        .set(MESSAGE_ACTION_PROPOSAL.MESSAGE_ID, messageId)
        .set(MESSAGE_ACTION_PROPOSAL.CHANNEL_ID, channelId)
        .set(MESSAGE_ACTION_PROPOSAL.PROPOSED_BY_USER_ID, proposedByUserId)
        .set(MESSAGE_ACTION_PROPOSAL.ACTION_TYPE, actionType)
        .set(MESSAGE_ACTION_PROPOSAL.PAYLOAD, JSONB.valueOf(payloadJson))
        .returning(MESSAGE_ACTION_PROPOSAL.ID)
        .fetchOne()
        .getId();
  }

  /** id 로 제안 1건 조회. */
  public Optional<ProposalRow> findById(long id) {
    return dsl.selectFrom(MESSAGE_ACTION_PROPOSAL)
        .where(MESSAGE_ACTION_PROPOSAL.ID.eq(id))
        .fetchOptional(this::map);
  }

  /**
   * 여러 message_id 에 해당하는 제안을 일괄 조회(배치 enrich 용). messageIds 가 비어 있으면 DB 쿼리 없이 빈 리스트 반환.
   */
  public List<ProposalRow> findByMessageIds(Collection<Long> messageIds) {
    if (messageIds.isEmpty()) return List.of();
    return dsl.selectFrom(MESSAGE_ACTION_PROPOSAL)
        .where(MESSAGE_ACTION_PROPOSAL.MESSAGE_ID.in(messageIds))
        .fetch(this::map);
  }

  /**
   * status 전이 — PENDING 일 때만 UPDATE(멱등 가드). resultIssueKey 는 null 가능(거부 시). 영향 행 수 > 0 이면 true.
   */
  public boolean updateStatus(long id, String status, String resultIssueKey, long resolvedBy) {
    return dsl.update(MESSAGE_ACTION_PROPOSAL)
            .set(MESSAGE_ACTION_PROPOSAL.STATUS, status)
            .set(MESSAGE_ACTION_PROPOSAL.RESULT_ISSUE_KEY, resultIssueKey)
            .set(MESSAGE_ACTION_PROPOSAL.RESOLVED_BY, resolvedBy)
            .set(MESSAGE_ACTION_PROPOSAL.RESOLVED_AT, OffsetDateTime.now())
            .where(MESSAGE_ACTION_PROPOSAL.ID.eq(id))
            .and(MESSAGE_ACTION_PROPOSAL.STATUS.eq("PENDING"))
            .execute()
        > 0;
  }

  /** jOOQ Record → ProposalRow 매핑 헬퍼. JSONB 는 .data() 로 문자열 추출, OffsetDateTime 은 Instant 로 변환. */
  private ProposalRow map(Record r) {
    OffsetDateTime resolvedAt = r.get(MESSAGE_ACTION_PROPOSAL.RESOLVED_AT);
    OffsetDateTime createdAt = r.get(MESSAGE_ACTION_PROPOSAL.CREATED_AT);
    return new ProposalRow(
        r.get(MESSAGE_ACTION_PROPOSAL.ID),
        r.get(MESSAGE_ACTION_PROPOSAL.MESSAGE_ID),
        r.get(MESSAGE_ACTION_PROPOSAL.CHANNEL_ID),
        r.get(MESSAGE_ACTION_PROPOSAL.PROPOSED_BY_USER_ID),
        r.get(MESSAGE_ACTION_PROPOSAL.ACTION_TYPE),
        r.get(MESSAGE_ACTION_PROPOSAL.PAYLOAD).data(),
        r.get(MESSAGE_ACTION_PROPOSAL.STATUS),
        r.get(MESSAGE_ACTION_PROPOSAL.RESULT_ISSUE_KEY),
        r.get(MESSAGE_ACTION_PROPOSAL.RESOLVED_BY),
        resolvedAt == null ? null : resolvedAt.toInstant(),
        createdAt.toInstant());
  }
}

package com.workplace.home.repository;

import static com.workplace.jooq.Tables.HOME_ACTION_PROPOSAL;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * home_action_proposal 접근(#843). 상태 전이는 모두 {@code WHERE status='PENDING'} 조건부 UPDATE 로만 한다 — 영향 행
 * 수가 0 이면 이미 다른 요청이 처리했다는 뜻이라 호출부가 409 로 거절할 수 있고, 행 잠금이 동시 이중 승인을 직렬화한다.
 */
@Repository
@RequiredArgsConstructor
public class HomeActionProposalRepository {

  public static final String PENDING = "PENDING";
  public static final String DONE = "DONE";
  public static final String FAILED = "FAILED";
  public static final String REJECTED = "REJECTED";
  public static final String EXPIRED = "EXPIRED";

  private final DSLContext dsl;

  /** 제안 1건 삽입 후 생성 행 반환. params 는 raw JSON 문자열. */
  public Row insert(UUID sessionId, long userId, String actionType, String summary, String params) {
    return dsl.insertInto(HOME_ACTION_PROPOSAL)
        .set(HOME_ACTION_PROPOSAL.SESSION_ID, sessionId)
        .set(HOME_ACTION_PROPOSAL.USER_ID, userId)
        .set(HOME_ACTION_PROPOSAL.ACTION_TYPE, actionType)
        .set(HOME_ACTION_PROPOSAL.SUMMARY, summary)
        .set(HOME_ACTION_PROPOSAL.PARAMS, JSONB.valueOf(params))
        .returning()
        .fetchOne(HomeActionProposalRepository::toRow);
  }

  public Optional<Row> findById(long id) {
    return dsl.selectFrom(HOME_ACTION_PROPOSAL)
        .where(HOME_ACTION_PROPOSAL.ID.eq(id))
        .fetchOptional(HomeActionProposalRepository::toRow);
  }

  /** 세션의 미처리 제안을 생성순으로 — 세션 복원 시 카드 재표시용. */
  public List<Row> findPendingBySession(UUID sessionId) {
    return dsl.selectFrom(HOME_ACTION_PROPOSAL)
        .where(HOME_ACTION_PROPOSAL.SESSION_ID.eq(sessionId))
        .and(HOME_ACTION_PROPOSAL.STATUS.eq(PENDING))
        .orderBy(HOME_ACTION_PROPOSAL.ID.asc())
        .fetch(HomeActionProposalRepository::toRow);
  }

  /**
   * PENDING 인 경우에만 종결 상태로 전이한다.
   *
   * @return 전이 성공 여부(false = 이미 처리됨)
   */
  public boolean resolve(long id, String status, String errorMessage) {
    return dsl.update(HOME_ACTION_PROPOSAL)
            .set(HOME_ACTION_PROPOSAL.STATUS, status)
            .set(HOME_ACTION_PROPOSAL.ERROR_MESSAGE, errorMessage)
            .set(HOME_ACTION_PROPOSAL.RESOLVED_AT, OffsetDateTime.now())
            .where(HOME_ACTION_PROPOSAL.ID.eq(id))
            .and(HOME_ACTION_PROPOSAL.STATUS.eq(PENDING))
            .execute()
        == 1;
  }

  /** 세션의 미처리 제안을 일괄 만료 — 새 질문이 오면 이전 카드는 폐기된다. */
  public int expirePending(UUID sessionId) {
    return dsl.update(HOME_ACTION_PROPOSAL)
        .set(HOME_ACTION_PROPOSAL.STATUS, EXPIRED)
        .set(HOME_ACTION_PROPOSAL.RESOLVED_AT, OffsetDateTime.now())
        .where(HOME_ACTION_PROPOSAL.SESSION_ID.eq(sessionId))
        .and(HOME_ACTION_PROPOSAL.STATUS.eq(PENDING))
        .execute();
  }

  private static Row toRow(Record r) {
    return new Row(
        r.get(HOME_ACTION_PROPOSAL.ID),
        r.get(HOME_ACTION_PROPOSAL.SESSION_ID),
        r.get(HOME_ACTION_PROPOSAL.USER_ID),
        r.get(HOME_ACTION_PROPOSAL.ACTION_TYPE),
        r.get(HOME_ACTION_PROPOSAL.SUMMARY),
        r.get(HOME_ACTION_PROPOSAL.PARAMS).data(),
        r.get(HOME_ACTION_PROPOSAL.STATUS),
        r.get(HOME_ACTION_PROPOSAL.ERROR_MESSAGE));
  }

  /** 제안 단건 row. params 는 raw JSON 문자열. */
  public record Row(
      long id,
      UUID sessionId,
      long userId,
      String actionType,
      String summary,
      String paramsJson,
      String status,
      String errorMessage) {}
}

package com.workplace.notify.push;

import static com.workplace.jooq.Tables.PUSH_SUBSCRIPTION;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** push_subscription 접근. 글로벌 테이블이라 테넌트 GUC 없이 동작한다. */
@Repository
@RequiredArgsConstructor
public class PushSubscriptionRepository {

  private final DSLContext dsl;

  /** endpoint 기준 upsert. 이미 있으면 소유자·키를 덮어쓰고 실패 카운트를 초기화한다(계정 전환 시 소유자 이전). */
  public void upsert(long userId, String endpoint, String p256dh, String auth, String userAgent) {
    OffsetDateTime now = OffsetDateTime.now();
    dsl.insertInto(PUSH_SUBSCRIPTION)
        .set(PUSH_SUBSCRIPTION.USER_ID, userId)
        .set(PUSH_SUBSCRIPTION.ENDPOINT, endpoint)
        .set(PUSH_SUBSCRIPTION.P256DH, p256dh)
        .set(PUSH_SUBSCRIPTION.AUTH, auth)
        .set(PUSH_SUBSCRIPTION.USER_AGENT, userAgent)
        .onConflict(PUSH_SUBSCRIPTION.ENDPOINT)
        .doUpdate()
        .set(PUSH_SUBSCRIPTION.USER_ID, userId)
        .set(PUSH_SUBSCRIPTION.P256DH, p256dh)
        .set(PUSH_SUBSCRIPTION.AUTH, auth)
        .set(PUSH_SUBSCRIPTION.USER_AGENT, userAgent)
        .set(PUSH_SUBSCRIPTION.FAILURE_COUNT, 0)
        .set(PUSH_SUBSCRIPTION.UPDATED_AT, now)
        .execute();
  }

  /** 사용자 구독을 최신(updated_at) limit 개만 남기고 삭제. 삭제 건수 반환. */
  public int trimToLimit(long userId, int limit) {
    var keep =
        dsl.select(PUSH_SUBSCRIPTION.ID)
            .from(PUSH_SUBSCRIPTION)
            .where(PUSH_SUBSCRIPTION.USER_ID.eq(userId))
            .orderBy(PUSH_SUBSCRIPTION.UPDATED_AT.desc(), PUSH_SUBSCRIPTION.ID.desc())
            .limit(limit);
    return dsl.deleteFrom(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.USER_ID.eq(userId))
        .and(PUSH_SUBSCRIPTION.ID.notIn(keep))
        .execute();
  }

  /** 본인 소유 구독만 삭제(타인 endpoint 삭제 방지). 삭제 건수 반환. */
  public int deleteByUserAndEndpoint(long userId, String endpoint) {
    return dsl.deleteFrom(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.USER_ID.eq(userId))
        .and(PUSH_SUBSCRIPTION.ENDPOINT.eq(endpoint))
        .execute();
  }

  /** 수신자들의 모든 구독. 빈 입력은 빈 결과. */
  public List<PushSubscriptionRow> findByUserIds(Collection<Long> userIds) {
    if (userIds.isEmpty()) return List.of();
    return dsl.select(
            PUSH_SUBSCRIPTION.ID,
            PUSH_SUBSCRIPTION.USER_ID,
            PUSH_SUBSCRIPTION.ENDPOINT,
            PUSH_SUBSCRIPTION.P256DH,
            PUSH_SUBSCRIPTION.AUTH)
        .from(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.USER_ID.in(userIds))
        .orderBy(PUSH_SUBSCRIPTION.ID)
        .fetch(
            r ->
                new PushSubscriptionRow(
                    r.get(PUSH_SUBSCRIPTION.ID),
                    r.get(PUSH_SUBSCRIPTION.USER_ID),
                    r.get(PUSH_SUBSCRIPTION.ENDPOINT),
                    r.get(PUSH_SUBSCRIPTION.P256DH),
                    r.get(PUSH_SUBSCRIPTION.AUTH)));
  }

  /** endpoint 현재 소유자(테스트·진단용). */
  public Optional<Long> findOwner(String endpoint) {
    return dsl.select(PUSH_SUBSCRIPTION.USER_ID)
        .from(PUSH_SUBSCRIPTION)
        .where(PUSH_SUBSCRIPTION.ENDPOINT.eq(endpoint))
        .fetchOptional(PUSH_SUBSCRIPTION.USER_ID);
  }

  /** 발송 성공 — 연속 실패 초기화 + 마지막 성공 시각 기록. */
  public void markSuccess(long id) {
    dsl.update(PUSH_SUBSCRIPTION)
        .set(PUSH_SUBSCRIPTION.FAILURE_COUNT, 0)
        .set(PUSH_SUBSCRIPTION.LAST_SUCCESS_AT, OffsetDateTime.now())
        .where(PUSH_SUBSCRIPTION.ID.eq(id))
        .execute();
  }

  /** 일시 실패 1회 누적 후 누적값 반환(행이 없으면 0). */
  public int incrementFailure(long id) {
    return dsl.update(PUSH_SUBSCRIPTION)
        .set(PUSH_SUBSCRIPTION.FAILURE_COUNT, PUSH_SUBSCRIPTION.FAILURE_COUNT.plus(1))
        .where(PUSH_SUBSCRIPTION.ID.eq(id))
        .returning(PUSH_SUBSCRIPTION.FAILURE_COUNT)
        .fetchOptional(PUSH_SUBSCRIPTION.FAILURE_COUNT)
        .orElse(0);
  }

  /** 만료·무효 구독 삭제. */
  public void deleteById(long id) {
    dsl.deleteFrom(PUSH_SUBSCRIPTION).where(PUSH_SUBSCRIPTION.ID.eq(id)).execute();
  }
}

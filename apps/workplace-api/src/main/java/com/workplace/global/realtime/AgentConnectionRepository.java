package com.workplace.global.realtime;

import static com.workplace.jooq.Tables.AGENT_CONNECTION;
import static com.workplace.jooq.Tables.USER;

import com.workplace.user.dto.UserKind;
import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * agent_connection(AI 사용자별 마지막 연결 확인 시각) 접근. 파드마다 메모리가 달라 「외부 AI 연결됨」을 한 파드의 SSE map 으로 판정할 수
 * 없어(WP-1975) 파드가 적고 읽는 쪽이 이 표 하나만 본다. 표는 사용자 단위 글로벌(비-RLS)이라 테넌트 GUC 없이 동작한다. 시각은 파드 시계가 아니라 DB
 * now() 로만 적고 읽는다.
 */
@Repository
@RequiredArgsConstructor
public class AgentConnectionRepository {

  /**
   * 쓰기 문장이 기다리는 최대 시간(초). 부르는 곳이 SSE 접속 요청과 기록기의 하나뿐인 타이머라, 잠금 대기가 끝없으면 접속이 멈추고 이 파드의 AI 가 모두 끊김으로
   * 보인다.
   */
  private static final int WRITE_TIMEOUT_SECONDS = 5;

  private final DSLContext dsl;

  /** 마지막 확인 시각 {@code at} 과, 같은 문장에서 읽은 DB 현재 시각 {@code now}(판정 시계). */
  public record LastSeen(Instant at, Instant now) {}

  /**
   * 주어진 사용자 중 AI(kind=AGENT)의 마지막 확인 시각을 DB now() 로 적는다. 사람·없는 id 는 건너뛴다(행을 만들지 않음). 시각은 앞으로만 간다 —
   * GREATEST(기존, now()) 라 늦게 도착한 쓰기가 값을 되돌리지 못한다. 묶음 upsert 는 user id 오름차순으로 잠가 파드 간 교착을 막는다. 빈
   * 입력이면 DB 를 부르지 않는다.
   */
  public void touch(Collection<Long> userIds) {
    if (userIds.isEmpty()) {
      return;
    }
    dsl.insertInto(AGENT_CONNECTION, AGENT_CONNECTION.USER_ID, AGENT_CONNECTION.LAST_SEEN_AT)
        .select(
            dsl.select(USER.ID, DSL.currentOffsetDateTime())
                .from(USER)
                .where(USER.ID.in(userIds))
                .and(USER.KIND.eq(UserKind.AGENT))
                .orderBy(USER.ID))
        .onConflict(AGENT_CONNECTION.USER_ID)
        .doUpdate()
        .set(
            AGENT_CONNECTION.LAST_SEEN_AT,
            DSL.greatest(
                AGENT_CONNECTION.LAST_SEEN_AT, DSL.excluded(AGENT_CONNECTION.LAST_SEEN_AT)))
        .queryTimeout(WRITE_TIMEOUT_SECONDS)
        .execute();
  }

  /** 사용자별 마지막 확인 시각과 같은 문장의 DB now() 를 함께 읽는다. 행이 없는 id 는 결과에 키가 없다. 빈 입력이면 DB 를 부르지 않는다. */
  public Map<Long, LastSeen> findLastSeen(Collection<Long> userIds) {
    if (userIds.isEmpty()) {
      return Map.of();
    }
    return dsl.select(
            AGENT_CONNECTION.USER_ID, AGENT_CONNECTION.LAST_SEEN_AT, DSL.currentOffsetDateTime())
        .from(AGENT_CONNECTION)
        .where(AGENT_CONNECTION.USER_ID.in(userIds))
        .fetchMap(
            AGENT_CONNECTION.USER_ID,
            r -> new LastSeen(r.value2().toInstant(), r.value3().toInstant()));
  }
}

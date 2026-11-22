package com.workplace.global.realtime;

import static com.workplace.jooq.Tables.AGENT_CONNECTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.workplace.global.realtime.AgentConnectionRepository.LastSeen;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.sql.Connection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.sql.DataSource;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * agent_connection 접근 검증. 트랜잭션 안에서 Postgres now() 는 트랜잭션 시작 시각으로 고정되므로, touch 가 적은 시각과 find 가 읽은
 * now 가 정확히 같다.
 */
@Transactional
class AgentConnectionRepositoryTest extends IntegrationTestBase {

  @Autowired AgentConnectionRepository repo;
  @Autowired DSLContext dsl;
  @Autowired DataSource dataSource;

  /** DB now() 에서 분 단위로 어긋난 시각으로 행을 직접 심는다. */
  private void seedRow(long userId, int minutesFromNow) {
    dsl.execute(
        "INSERT INTO agent_connection (user_id, last_seen_at) VALUES (?, now() + make_interval(mins => ?))",
        userId,
        minutesFromNow);
  }

  @Test
  void touch_writesOnlyExistingAgents() {
    long agent = TestFixtures.createAgentNoToken(dsl);
    long human = TestFixtures.createHuman(dsl);
    long missing = -12345L;

    repo.touch(List.of(agent, human, missing));

    Map<Long, LastSeen> found = repo.findLastSeen(List.of(agent, human, missing));
    assertThat(found).containsOnlyKeys(agent);
    LastSeen seen = found.get(agent);
    assertThat(seen.at()).isEqualTo(seen.now());
    assertThat(dsl.fetchCount(AGENT_CONNECTION, AGENT_CONNECTION.USER_ID.in(human, missing)))
        .isZero();
  }

  @Test
  void touch_advancesOlderValue() {
    long agent = TestFixtures.createAgentNoToken(dsl);
    seedRow(agent, -10);
    LastSeen stale = repo.findLastSeen(List.of(agent)).get(agent);
    assertThat(stale.at()).isBefore(stale.now());

    repo.touch(List.of(agent));

    LastSeen seen = repo.findLastSeen(List.of(agent)).get(agent);
    assertThat(seen.at()).isEqualTo(seen.now());
  }

  @Test
  void touch_neverMovesBackwards() {
    long agent = TestFixtures.createAgentNoToken(dsl);
    seedRow(agent, 5);
    OffsetDateTime before =
        dsl.select(AGENT_CONNECTION.LAST_SEEN_AT)
            .from(AGENT_CONNECTION)
            .where(AGENT_CONNECTION.USER_ID.eq(agent))
            .fetchOne(AGENT_CONNECTION.LAST_SEEN_AT);

    repo.touch(List.of(agent));

    LastSeen seen = repo.findLastSeen(List.of(agent)).get(agent);
    assertThat(seen.at()).isEqualTo(before.toInstant());
    assertThat(seen.at()).isAfter(seen.now());
  }

  /** 행이 잠겨 있으면 제한 시간 안에 포기한다 — 기다리기만 하면 기록기의 하나뿐인 타이머와 SSE 접속이 함께 멈춘다. */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED) // 다른 커넥션이 잠글 수 있게 커밋된 행이 필요하다
  void touch_whenRowIsLocked_givesUpWithinTimeout() throws Exception {
    long agent = TestFixtures.createAgentNoToken(dsl);
    repo.touch(List.of(agent));
    CompletableFuture<Void> write;
    Throwable failure;
    try (Connection locker = dataSource.getConnection()) {
      locker.setAutoCommit(false);
      try (var st =
          locker.prepareStatement("SELECT 1 FROM agent_connection WHERE user_id = ? FOR UPDATE")) {
        st.setLong(1, agent);
        st.executeQuery().close();
      }
      write = CompletableFuture.runAsync(() -> repo.touch(List.of(agent)));
      failure = catchThrowable(() -> write.get(15, TimeUnit.SECONDS));
      locker.rollback();
    }
    catchThrowable(() -> write.get(15, TimeUnit.SECONDS)); // 잠금을 푼 뒤 쓰기가 끝나야 치울 수 있다
    dsl.deleteFrom(USER).where(USER.ID.eq(agent)).execute();

    assertThat(failure).isNotNull().isNotInstanceOf(TimeoutException.class);
  }

  @Test
  void emptyInput_isNoop() {
    repo.touch(List.of());
    assertThat(repo.findLastSeen(List.of())).isEmpty();
  }
}

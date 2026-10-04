package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.repository.HomeSessionRepository.SummaryState;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** home_session 누적 요약 저장(WP-232) — 기본 빈 상태, 조건부 갱신(동시 요약끼리 덮어쓰기 방지). */
class HomeSessionContextSummaryTest extends IntegrationTestBase {

  @Autowired HomeSessionService sessionService;
  @Autowired DSLContext dsl;
  private final List<Long> users = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!users.isEmpty()) dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    users.clear();
  }

  private long user() {
    String n = "ctxsum" + System.nanoTime();
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, n)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, n)
            .set(USER.EMAIL, n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    return id;
  }

  @Test
  void 새_세션은_요약이_비어있다() {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    assertThat(sessionService.getContextSummary(uid, sid)).isEqualTo(new SummaryState(null, null));
  }

  @Test
  void 기대_경계가_일치할_때만_저장되고_어긋나면_0행() {
    long uid = user();
    UUID sid = sessionService.create(uid).id();

    assertThat(sessionService.saveContextSummary(uid, sid, null, "첫 요약", 10L)).isEqualTo(1);
    assertThat(sessionService.getContextSummary(uid, sid)).isEqualTo(new SummaryState("첫 요약", 10L));

    // 늦게 끝난 다른 요약(기대 경계 null) — 이미 10 으로 바뀌어 0행, 기존 값 유지.
    assertThat(sessionService.saveContextSummary(uid, sid, null, "경합 패배", 7L)).isZero();
    assertThat(sessionService.getContextSummary(uid, sid)).isEqualTo(new SummaryState("첫 요약", 10L));

    assertThat(sessionService.saveContextSummary(uid, sid, 10L, "둘째 요약", 20L)).isEqualTo(1);
    assertThat(sessionService.getContextSummary(uid, sid))
        .isEqualTo(new SummaryState("둘째 요약", 20L));
  }

  /** 맥락 원천(WP-232) — 요약 상태와 경계(uptoId) 이후 메시지의 id·role·content 만 생성순으로 읽는다. */
  @Test
  void 맥락원천은_요약상태와_경계이후_메시지만_생성순으로_돌려준다() {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long m1 = sessionService.appendMessage(uid, sid, "USER", "q1", null, null, null);
    long m2 = sessionService.appendMessage(uid, sid, "ASSISTANT", "a1", "[]", null, null);
    long m3 = sessionService.appendMessage(uid, sid, "USER", "q2", null, null, null);

    // 요약 전 — 전체(경계 필터 없음).
    var all = sessionService.getContextSource(uid, sid);
    assertThat(all.state()).isEqualTo(new SummaryState(null, null));
    assertThat(all.rows()).extracting(r -> r.id()).containsExactly(m1, m2, m3);
    assertThat(all.rows().get(1).role()).isEqualTo("ASSISTANT");
    assertThat(all.rows().get(1).content()).isEqualTo("a1");

    // 요약 후 — 경계(m2) 초과분만.
    sessionService.saveContextSummary(uid, sid, null, "요약", m2);
    var after = sessionService.getContextSource(uid, sid);
    assertThat(after.state()).isEqualTo(new SummaryState("요약", m2));
    assertThat(after.rows()).extracting(r -> r.content()).containsExactly("q2");
  }
}

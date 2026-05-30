package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.dto.HomeSessionSummary;
import com.workplace.home.exception.HomeSessionNotFoundException;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 세션 CRUD + 소유권 + 제목 자동생성 + 메시지 영속/복원. */
@Transactional
class HomeSessionServiceTest extends IntegrationTestBase {

  @Autowired HomeSessionService sessionService;
  @Autowired DSLContext dsl;

  private long user(String n) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, n)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, n)
        .set(USER.EMAIL, n + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void create_append_listAndRestore() {
    long u = user("u" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(u);

    sessionService.appendMessage(u, s.id(), "USER", "막힌 내 이슈 보여줘", null);
    sessionService.appendMessage(
        u,
        s.id(),
        "ASSISTANT",
        "차단된 이슈 2건이에요",
        "[{\"type\":\"issue_list\",\"params\":{\"blocked\":true}}]");

    List<HomeSessionSummary> list = sessionService.list(u, null, 30).items();
    assertThat(list).hasSize(1);
    assertThat(list.get(0).title()).isEqualTo("막힌 내 이슈 보여줘");
    assertThat(list.get(0).widgetCount()).isEqualTo(1);

    List<HomeMessageResponse> msgs = sessionService.getMessages(u, s.id());
    assertThat(msgs).hasSize(2);
    assertThat(msgs.get(0).role()).isEqualTo("USER");
    assertThat(msgs.get(1).widgets().get(0).get("type").asText()).isEqualTo("issue_list");
  }

  @Test
  void getMessages_byNonOwner_throwsNotFound() {
    long owner = user("own" + System.nanoTime());
    long other = user("oth" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(owner);

    assertThatThrownBy(() -> sessionService.getMessages(other, s.id()))
        .isInstanceOf(HomeSessionNotFoundException.class);
  }

  @Test
  void delete_byOwner_removes() {
    long u = user("del" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(u);

    sessionService.delete(u, s.id());

    assertThat(sessionService.list(u, null, 30).items()).isEmpty();
  }
}

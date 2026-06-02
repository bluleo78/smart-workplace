package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** DM find-or-create·검증 통합 테스트(실제 DB). */
class DmServiceTest extends IntegrationTestBase {

  @Autowired DmService dmService;
  @Autowired DSLContext dsl;

  /** 고유 username/email 로 user 1행 insert 후 id 반환 — 공유 test DB(롤백 없음) 충돌 회피. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ds_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ds" + s)
        .set(USER.EMAIL, "ds_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void createOrGet_oneToOne_isDeduped() {
    long a = seedUser();
    long b = seedUser();

    var first = dmService.createOrGet(a, List.of(b));
    var again = dmService.createOrGet(a, List.of(b));
    var reversed = dmService.createOrGet(b, List.of(a)); // 순서 무관

    assertThat(first.created()).isTrue();
    assertThat(again.created()).isFalse();
    assertThat(again.dm().id()).isEqualTo(first.dm().id());
    assertThat(reversed.dm().id()).isEqualTo(first.dm().id());
  }

  @Test
  void createOrGet_group_dedupBySet() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();

    var g1 = dmService.createOrGet(a, List.of(b, c));
    var g1again = dmService.createOrGet(a, List.of(c, b)); // 같은 셋
    var g2 = dmService.createOrGet(a, List.of(b)); // 다른 셋

    assertThat(g1again.dm().id()).isEqualTo(g1.dm().id());
    assertThat(g2.dm().id()).isNotEqualTo(g1.dm().id());
  }

  @Test
  void createOrGet_rejectsInvalid() {
    long a = seedUser();
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of()))
        .isInstanceOf(InvalidDmRequestException.class);
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of(a))) // self-only
        .isInstanceOf(InvalidDmRequestException.class);
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of(999_999_999L))) // 미존재
        .isInstanceOf(InvalidDmRequestException.class);
  }

  @Test
  void createOrGet_rejectsOverEight() {
    long a = seedUser();
    List<Long> targets =
        java.util.stream.IntStream.range(0, 8) // 본인+8 = 9 > 8
            .mapToObj(i -> seedUser())
            .toList();
    assertThatThrownBy(() -> dmService.createOrGet(a, targets))
        .isInstanceOf(InvalidDmRequestException.class);
  }

  @Test
  void listMyDms_returnsOnlyMine() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    dmService.createOrGet(a, List.of(b));
    dmService.createOrGet(b, List.of(c)); // a 무관 DM

    assertThat(dmService.listMyDms(a)).hasSize(1);
  }
}

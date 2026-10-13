package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.dto.UndoAiMemoryRequest;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Review Focus 1: 같은 forgotten 결과 줄을 두 탭에서 동시에 되돌려도 메모리는 한 개만 다시 생긴다 — 메시지 행 잠금(FOR UPDATE)으로 두 번째
 * 요청이 첫 번째의 undone=true 를 본다. 실제 커밋 경합이 필요해 @Transactional 을 쓰지 않는다(경합·정리 틀은
 * AiMemoryRaceTestSupport).
 */
class AiMemoryUndoConcurrencyTest extends AiMemoryRaceTestSupport {

  @Autowired AiMemoryUndoService undoService;
  @Autowired AiMemoryRepository repo;
  @Autowired HomeSessionService sessions;

  @Test
  void 같은_지움_결과를_동시에_두_번_되돌려도_하나만_다시_생긴다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    users.add(uid);
    long mid =
        inTenant(
            () -> {
              UUID sid = sessions.create(uid).id();
              sessions.appendMessage(uid, sid, "USER", "질문", null, null, null);
              return sessions.appendMessage(
                  uid,
                  sid,
                  "ASSISTANT",
                  "잊을게요.",
                  null,
                  null,
                  "[{\"kind\":\"memory\",\"action\":\"forgotten\",\"memoryId\":987654,\"memoryKind\":\"CONTEXT\","
                      + "\"content\":\"백엔드 팀이다\",\"source\":\"USER\",\"undone\":false}]");
            });

    var results =
        raceTwice(
            () ->
                undoService.undo(uid, new UndoAiMemoryRequest(mid, 0)).memory() == null
                    ? "noop"
                    : "restored");

    assertThat(results).containsExactlyInAnyOrder("restored", "noop");
    assertThat(inTenant(() -> repo.count(uid))).isEqualTo(1);
    assertThat(inTenant(() -> repo.listNewest(uid, 50)).get(0).source()).isEqualTo("USER");
  }
}

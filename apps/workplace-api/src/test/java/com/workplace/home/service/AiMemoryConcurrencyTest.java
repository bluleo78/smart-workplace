package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.support.TestFixtures;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** WP-55 Review Focus 2: 49개에서 두 요청이 동시에 와도 50개를 넘지 않는다. 경합·정리 틀은 AiMemoryRaceTestSupport. */
class AiMemoryConcurrencyTest extends AiMemoryRaceTestSupport {

  @Autowired AiMemoryService service;
  @Autowired AiMemoryRepository repo;

  @Test
  void 마흔아홉개에서_동시에_두_건을_추가해도_하나만_저장된다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    users.add(uid);
    inTenant(
        () -> {
          for (int i = 0; i < 49; i++)
            repo.insert(uid, new NewMemory("PREFERENCE", "m" + i, "USER", null, null, null));
          return null;
        });

    var results =
        raceTwice(
            () -> {
              try {
                AiMemoryTestFixtures.createMemory(
                    service, uid, "PREFERENCE", "동시 " + Thread.currentThread().threadId());
                return "ok";
              } catch (AiMemoryException e) {
                return e.code();
              }
            });

    assertThat(results).containsExactlyInAnyOrder("ok", "AI_MEMORY_FULL");
    assertThat(inTenant(() -> AiMemoryTestFixtures.countMemories(dsl, uid))).isEqualTo(50);
  }
}

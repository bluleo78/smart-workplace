package com.workplace.issue.workflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModelJson;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** WP-1985 버전 모델 캐시 단위 테스트(Spring 없음) — 꺼낸 모델을 바꿔도 캐시가 오염되지 않고, 상한을 넘으면 가장 오래 쓰지 않은 버전이 빠지는지 본다. */
class WorkflowModelCacheTest {

  /** 예시 정의를 게시본과 같은 JSON 으로. */
  private static String specJson() throws IOException {
    String yaml =
        Files.readString(
            Path.of("src/test/resources/workflow/spec-example.yaml"), StandardCharsets.UTF_8);
    return WorkflowModelJson.write(WorkflowYamlParser.parse(yaml).model());
  }

  @Test
  @DisplayName("꺼낸 사본의 nodes·outcomes 를 바꿔도 다음 get 은 원본 그대로이고 JSON 을 다시 읽지 않는다")
  void copy_mutationDoesNotLeak() throws IOException {
    WorkflowModelCache cache = new WorkflowModelCache();
    String json = specJson();
    AtomicInteger reads = new AtomicInteger();

    WorkflowModel first =
        cache.get(
            1L,
            () -> {
              reads.incrementAndGet();
              return json;
            });
    first.nodes().get("dev").outcomes().clear();
    first.nodes().remove("triage");

    WorkflowModel second = cache.get(1L, () -> "{ 읽으면 안 된다 }");

    assertThat(reads).hasValue(1);
    assertThat(second).isNotSameAs(first);
    assertThat(second.nodes()).containsKey("triage");
    assertThat(second.nodes().get("dev").outcomes()).containsOnlyKeys("submitted", "ask");
  }

  @Test
  @DisplayName("501 번째 버전을 넣으면 가장 오래 쓰지 않은 것이 빠지고 크기는 500 이다")
  void lru_evictsEldestAt501() throws IOException {
    WorkflowModelCache cache = new WorkflowModelCache();
    String json = specJson();
    AtomicInteger reads = new AtomicInteger();
    for (long id = 1; id <= WorkflowModelCache.MAX_ENTRIES + 1; id++) {
      cache.get(
          id,
          () -> {
            reads.incrementAndGet();
            return json;
          });
    }
    assertThat(cache.size()).isEqualTo(WorkflowModelCache.MAX_ENTRIES);
    assertThat(reads).hasValue(WorkflowModelCache.MAX_ENTRIES + 1);

    // 가장 최근 것은 남아 있어 다시 읽지 않는다.
    cache.get(WorkflowModelCache.MAX_ENTRIES + 1L, () -> "{ 읽으면 안 된다 }");
    assertThat(reads).hasValue(WorkflowModelCache.MAX_ENTRIES + 1);

    // 가장 오래된 1 번은 빠져 다시 읽는다.
    cache.get(
        1L,
        () -> {
          reads.incrementAndGet();
          return json;
        });
    assertThat(reads).hasValue(WorkflowModelCache.MAX_ENTRIES + 2);
  }
}

package com.workplace.global.realtime.relay;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 아웃박스 정리(WP-1973) — 10분이 지난 {@code sse_relay_event} 행만 지우고 최신 행은 남긴다.
 *
 * <p>행은 {@code #id} 통지로 모든 파드가 되읽기 때문에 읽었다고 지우지 않고 나이로만 판정한다 — 이 테스트는 11분 지난 행 1개를 직접 넣어 정리되는지, 방금
 * 만든 행이 남는지 본다. 스케줄러(test 프로파일에서 꺼짐) 대신 cleaner 를 직접 불러 실행을 확인한다.
 */
class RelayOutboxCleanerTest extends IntegrationTestBase {

  /** 정리 작업 — 스케줄·잠금 없이 이 시점에 직접 실행한다(주기·잠금은 어노테이션과 아키텍처 테스트가 맡는다). */
  @Autowired private RelayOutboxCleaner cleaner;

  @AfterEach
  void 아웃박스를_비운다() {
    baseDsl.execute("DELETE FROM sse_relay_event"); // 공유 DB 에 테스트 행을 남기지 않는다
  }

  /** 11분 지난 행은 정리되고 방금 만든 행은 남는다 — 정리가 「나이」 로만 판정하는 계약. */
  @Test
  void 아웃박스_행은_정리된다() {
    baseDsl.execute(
        "DELETE FROM sse_relay_event"); // 공유 DB 에 앞 테스트가 남긴 행이 있으면 assertion 이 섞이지 않게 비운다
    baseDsl.execute(
        "INSERT INTO sse_relay_event(payload, created_at) "
            + "VALUES ('{\"mark\":\"old\"}', now() - interval '11 minutes')");
    baseDsl.execute(
        "INSERT INTO sse_relay_event(payload, created_at) VALUES ('{\"mark\":\"fresh\"}', now())");

    cleaner.scheduled();

    assertThat(남은_페이로드()).as("11분 지난 행은 지워지고 최신 행은 남는다").containsExactly("{\"mark\":\"fresh\"}");
  }

  /** 아웃박스에 남은 payload 목록(오래된 순) — 정리 결과를 행 단위로 가른다. */
  private List<String> 남은_페이로드() {
    return baseDsl
        .fetch("SELECT payload FROM sse_relay_event ORDER BY id")
        .getValues(0, String.class);
  }
}

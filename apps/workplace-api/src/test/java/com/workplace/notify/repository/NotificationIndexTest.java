package com.workplace.notify.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 알림 표 인덱스(WP-1695) — 보관(V300, WP-1689) 뒤 옛 인덱스 두 개를 지우고(V309), 목록·안 읽은 수 조회가 새 부분 인덱스를 타는지 본다.
 *
 * <p>EXPLAIN 은 테스트 DB 의 행이 적어 플래너가 순차 탐색을 고르므로, 트랜잭션 안에서만 순차 탐색을 끄고(SET LOCAL) 어떤 인덱스를 고르는지 본다. 조건은
 * {@link NotificationRepository#countUnread}·{@link NotificationRepository#listRecent} 의 알림 표 조건과
 * 같다 (받는 사람·안 읽음·보관 안 됨 / 받는 사람·보관 안 됨 + 최신순).
 */
class NotificationIndexTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;

  /** 마이그레이션 뒤 옛 두 인덱스는 없고, 새 _active 두 개와 보관용 인덱스가 있다. */
  @Test
  void legacyIndexesDropped_activeAndArchiveIndexesRemain() {
    List<String> names =
        dsl.fetch(
                "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
                    + " AND tablename = 'notification'")
            .getValues(0, String.class);

    assertThat(names)
        .doesNotContain("idx_notification_unread", "idx_notification_recipient_created")
        .contains(
            "idx_notification_unread_active",
            "idx_notification_recipient_created_active",
            "idx_notification_recipient_archived",
            "idx_notification_read_unarchived",
            "idx_notification_archived_at");
  }

  /**
   * 안 읽은 수 조건은 새 부분 인덱스(_active) 중 하나를 탄다. 빈 표에서는 두 _active 인덱스의 비용이 같아 어느 쪽을 고를지 정해지지 않는다 — 운영처럼
   * 행이 많으면 더 작은 idx_notification_unread_active 를 고른다. 여기서는 보관 조건을 품은 새 인덱스를 쓰는지만 본다.
   */
  @Test
  void countUnreadCondition_usesActivePartialIndex() {
    String plan =
        explain(
            "SELECT 1 FROM notification WHERE recipient_id = 1"
                + " AND read_at IS NULL AND archived_at IS NULL");

    assertThat(plan)
        .containsAnyOf(
            "idx_notification_unread_active", "idx_notification_recipient_created_active");
  }

  /** 최신순 목록 조건은 idx_notification_recipient_created_active 를 탄다. */
  @Test
  void listRecentCondition_usesRecipientCreatedActiveIndex() {
    String plan =
        explain(
            "SELECT id FROM notification WHERE recipient_id = 1 AND archived_at IS NULL"
                + " ORDER BY created_at DESC LIMIT 20");

    assertThat(plan).contains("idx_notification_recipient_created_active");
  }

  /** 순차 탐색을 이 트랜잭션에서만 끄고 실행 계획을 한 문자열로 돌려준다 — 풀의 연결에 설정이 남지 않게 SET LOCAL. */
  private String explain(String sql) {
    return dsl.transactionResult(
        cfg -> {
          cfg.dsl().execute("SET LOCAL enable_seqscan = off");
          return String.join("\n", cfg.dsl().fetch("EXPLAIN " + sql).getValues(0, String.class));
        });
  }
}

package com.workplace.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.repository.ConversationAttentionRepository;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * ConversationAttentionRepository 통합 테스트. 클래스 @Transactional 로 GUC 주입(set app.tenant_id)이 같은 트랜잭션
 * 내에서 동작한다.
 */
@Transactional
class ConversationAttentionRepositoryTest extends IntegrationTestBase {

  @Autowired ConversationAttentionRepository repo;
  @Autowired DSLContext dsl;

  /** 테스트마다 tenant GUC 주입 — RLS 통과를 위해 필수. */
  @BeforeEach
  void tenant() {
    dsl.execute("set app.tenant_id = '1'");
  }

  /** upsert 후 isFlagged=true, listForUser 반환 검증 */
  @Test
  void upsert_후_isFlagged_true_그리고_listForUser_반환() {
    repo.upsert(100L, 1L, "동희가 배포 여부 질문", 5000L);
    assertThat(repo.isFlagged(100L, 1L)).isTrue();
    assertThat(repo.isFlagged(100L, 2L)).isFalse();

    var marks = repo.listForUser(1L);
    assertThat(marks).hasSize(1);
    assertThat(marks.get(0).channelId()).isEqualTo(100L);
    assertThat(marks.get(0).classifiedMessageId()).isEqualTo(5000L);
  }

  /** upsert 재호출 시 reason 및 watermark가 최신 값으로 갱신됨을 확인 */
  @Test
  void upsert_재호출시_watermark_갱신() {
    repo.upsert(100L, 1L, "r1", 5000L);
    repo.upsert(100L, 1L, "r2", 5100L);
    var m = repo.listForUser(1L).get(0);
    assertThat(m.classifiedMessageId()).isEqualTo(5100L);
    assertThat(m.reason()).isEqualTo("r2");
  }

  /** deleteByChannelUser 호출 후 마크 제거 확인 */
  @Test
  void deleteByChannelUser_후_isFlagged_false() {
    repo.upsert(100L, 1L, "test reason", 5000L);
    assertThat(repo.isFlagged(100L, 1L)).isTrue();

    repo.deleteByChannelUser(100L, 1L);
    assertThat(repo.isFlagged(100L, 1L)).isFalse();
    assertThat(repo.listForUser(1L)).isEmpty();
  }
}

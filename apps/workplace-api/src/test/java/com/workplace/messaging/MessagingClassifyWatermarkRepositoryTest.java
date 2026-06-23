package com.workplace.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.repository.MessagingClassifyWatermarkRepository;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * MessagingClassifyWatermarkRepository 통합 테스트. per-채널 분류 watermark 의 get/advance 동작과 GREATEST 후퇴금지
 * 로직을 검증한다.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class MessagingClassifyWatermarkRepositoryTest {

  @Autowired MessagingClassifyWatermarkRepository repo;
  @Autowired DSLContext dsl;

  /** 테스트마다 tenant GUC 주입 — RLS 통과를 위해 필수. */
  @BeforeEach
  void tenant() {
    dsl.execute("set app.tenant_id = '1'");
  }

  /** 초기 get 은 0을 반환해야 함 */
  @Test
  void get_없으면_0_반환() {
    assertThat(repo.get(999L)).isEqualTo(0L);
  }

  /** advance 후 get 이 전진된 값을 반환 */
  @Test
  void advance_후_get_전진() {
    repo.advance(200L, 100L);
    assertThat(repo.get(200L)).isEqualTo(100L);
  }

  /** advance 로 더 작은 값을 전달해도 watermark 후퇴하지 않음(GREATEST) */
  @Test
  void advance_후퇴금지_GREATEST() {
    repo.advance(200L, 100L);
    repo.advance(200L, 50L); // 후퇴 시도
    assertThat(repo.get(200L)).isEqualTo(100L);
  }

  /** advance 재호출로 더 큰 값을 전달하면 전진 */
  @Test
  void advance_큰값으로_전진() {
    repo.advance(200L, 100L);
    repo.advance(200L, 200L);
    assertThat(repo.get(200L)).isEqualTo(200L);
  }
}

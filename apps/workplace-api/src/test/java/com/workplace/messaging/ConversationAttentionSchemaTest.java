package com.workplace.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * V85 마이그레이션 스키마 검증 — conversation_attention 및 messaging_classify_watermark 테이블의 존재와 FORCE RLS 설정을
 * 확인한다.
 */
class ConversationAttentionSchemaTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;

  /** conversation_attention 테이블이 생성됐는지 확인 */
  @Test
  void 테이블이_생성된다() {
    boolean exists =
        dsl.fetchExists(
            dsl.selectFrom("information_schema.tables")
                .where(DSL.field("table_name").eq("conversation_attention")));
    assertThat(exists).isTrue();
  }

  /** conversation_attention 에 FORCE RLS 가 설정됐는지 확인 */
  @Test
  void RLS_가_강제된다() {
    assertThat(
            dsl.fetchOne(
                    "select relforcerowsecurity from pg_class where relname='conversation_attention'")
                .get(0, Boolean.class))
        .isTrue();
  }

  /** messaging_classify_watermark 테이블이 생성됐는지 확인 */
  @Test
  void watermark_테이블이_생성된다() {
    boolean exists =
        dsl.fetchExists(
            dsl.selectFrom("information_schema.tables")
                .where(DSL.field("table_name").eq("messaging_classify_watermark")));
    assertThat(exists).isTrue();
  }

  /** messaging_classify_watermark 에 FORCE RLS 가 설정됐는지 확인 */
  @Test
  void watermark_RLS_가_강제된다() {
    assertThat(
            dsl.fetchOne(
                    "select relforcerowsecurity from pg_class where relname='messaging_classify_watermark'")
                .get(0, Boolean.class))
        .isTrue();
  }
}

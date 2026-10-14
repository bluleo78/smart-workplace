package com.workplace.support;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.HOME_MESSAGE;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.TextEmbeddingRepository;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메모리 임베딩 저장 상태를 읽는 테스트 공용 도구(WP-383) — 커밋된 값을 새 tenant#1 트랜잭션으로 읽어, 임베딩 채우기·선택 테스트가 같은 확인을 복붙하지 않게
 * 한다.
 */
public class MemoryEmbeddingProbe {

  private final DSLContext dsl;
  private final PlatformTransactionManager txManager;
  private final FakeTextEmbedder fake;

  public MemoryEmbeddingProbe(
      DSLContext dsl, PlatformTransactionManager txManager, FakeTextEmbedder fake) {
    this.dsl = dsl;
    this.txManager = txManager;
    this.fake = fake;
  }

  /** 저장된 임베딩이 이 텍스트의 가짜 벡터와 같은가(비었으면 false). */
  public boolean embeddingIs(long id, String text) {
    String literal = TextEmbeddingRepository.vectorLiteral(fake.expected(text));
    TenantContext.set(1L);
    Boolean r =
        new TransactionTemplate(txManager)
            .execute(
                st ->
                    dsl.select(
                            DSL.field(
                                "embedding = cast({0} as vector)", Boolean.class, DSL.val(literal)))
                        .from(AI_MEMORY)
                        .where(AI_MEMORY.ID.eq(id))
                        .fetchOne(0, Boolean.class));
    return Boolean.TRUE.equals(r);
  }

  /** 지금 트랜잭션에서 임베딩이 비었는가(같은 트랜잭션 안의 UPDATE 결과 확인용). */
  public boolean embeddingEmptyHere(long id) {
    return dsl.select(DSL.field("embedding IS NULL", Boolean.class))
        .from(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(id))
        .fetchOne(0, Boolean.class);
  }

  /** 대화 메시지(WP-384)의 저장된 임베딩이 이 텍스트의 가짜 벡터와 같은가(비었으면 false). */
  public boolean turnEmbeddingIs(long messageId, String text) {
    String literal = TextEmbeddingRepository.vectorLiteral(fake.expected(text));
    TenantContext.set(1L);
    Boolean r =
        new TransactionTemplate(txManager)
            .execute(
                st ->
                    dsl.select(
                            DSL.field(
                                "embedding = cast({0} as vector)", Boolean.class, DSL.val(literal)))
                        .from(HOME_MESSAGE)
                        .where(HOME_MESSAGE.ID.eq(messageId))
                        .fetchOne(0, Boolean.class));
    return Boolean.TRUE.equals(r);
  }

  /** 대화 메시지(WP-384)의 임베딩이 비었는가(커밋된 값). */
  public boolean turnEmbeddingEmpty(long messageId) {
    TenantContext.set(1L);
    Boolean r =
        new TransactionTemplate(txManager)
            .execute(
                st ->
                    dsl.select(DSL.field("embedding IS NULL", Boolean.class))
                        .from(HOME_MESSAGE)
                        .where(HOME_MESSAGE.ID.eq(messageId))
                        .fetchOne(0, Boolean.class));
    return Boolean.TRUE.equals(r);
  }
}

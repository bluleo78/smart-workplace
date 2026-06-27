package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.util.MailContentHash;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * EmailContentRepository 통합 테스트.
 *
 * <p>find-or-create 중복 차단, 본문 해시 기록, DB 해시 상호 일관성을 검증한다. 모든 repo 호출은 TenantContext +
 * TransactionTemplate 안에서 실행해 TenantAwareTransactionManager 가 GUC 를 주입하도록 한다(RLS WITH CHECK 통과 필수).
 */
class EmailContentRepositoryTest extends IntegrationTestBase {

  @Autowired EmailContentRepository repo;
  @Autowired DSLContext dsl;

  /** 테스트용 메시지 빌더 — 헤더 항목만 채움 (본문은 lazy 적재 대상). */
  private ParsedMessage msg(String messageId) {
    return new ParsedMessage(
        0L,
        messageId,
        messageId, // threadId
        null,
        null,
        "a@b.com",
        "A",
        "to@x.com",
        null,
        "subj",
        null,
        null,
        false,
        false,
        null,
        null,
        null,
        List.of());
  }

  /**
   * 동일 (tenant_id, message_id) 를 두 번 findOrCreate 하면 같은 content id 를 반환한다.
   *
   * <p>두 호출을 같은 트랜잭션 안에 넣어 GUC 주입을 보장한다. 트랜잭션 롤백으로 데이터 자동 정리.
   */
  @Test
  void findOrCreate_sharesBySameMessageId() {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                long c1 = repo.findOrCreate(1L, msg("<dup@x>"));
                long c2 = repo.findOrCreate(1L, msg("<dup@x>"));
                assertThat(c2).isEqualTo(c1); // 같은 message_id → 같은 content
                status.setRollbackOnly(); // 테스트 데이터 자동 정리
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /** updateBody 호출 후 bodyText, contentHash(64자), bodyFetchedAt 이 기록된다. */
  @Test
  void updateBody_setsHashAndFetchedAt() {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                long c = repo.findOrCreate(1L, msg("<body@x>"));
                repo.updateBody(c, "hello", null, "hello");
                var row = repo.findByIdForTest(c);
                assertThat(row.bodyText()).isEqualTo("hello");
                assertThat(row.contentHash()).hasSize(64);
                assertThat(row.bodyFetchedAt()).isNotNull();
                status.setRollbackOnly();
                return null;
              });
    } finally {
      TenantContext.clear();
    }
  }

  /**
   * Java MailContentHash 와 DB {@code encode(digest(...),'hex')} 결과가 동일해야 한다.
   *
   * <p>구분자 일관성 크로스-체크: V93 백필 SQL 의 {@code E'\\000'} 이 Java {@code "\\000"} 과 같은 바이트 시퀀스임을 DB 쿼리로
   * 잠근다. 이 테스트가 GREEN 이면 백필 해시와 런타임 해시가 항상 일치한다.
   */
  @Test
  void hashConsistency_javaMatchesDbPgcrypto() {
    String javaHash = MailContentHash.of("a", "b");

    // 이스케이프 체인: Java "E'\\\\000'" → SQL E'\\000' → Postgres 리터럴 \000 (4글자). MailContentHash 의
    // "\\000" 구분자와 동일 바이트여야 함 — 수정 시 주의.
    // pgcrypto: E'\\000' 는 리터럴 \000(4자) — Java "\\000" 과 동일
    String dbHash =
        dsl.fetchValue(
            DSL.field("encode(digest('a' || E'\\\\000' || 'b', 'sha256'), 'hex')", String.class));

    assertThat(javaHash)
        .as("Java MailContentHash 는 DB pgcrypto SHA-256 결과와 동일해야 한다(구분자 \\000 일치)")
        .isEqualTo(dbHash);
  }
}

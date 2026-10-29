package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1156 V242 — 사용자 이메일 제약(보이는 글자 없는 이메일 정리·대소문자만 다른 중복 정리·빈 이메일 CHECK·대소문자 무시 고유 인덱스).
 *
 * <p>정리 문장은 정리 전 상태(나쁜 행)가 있어야 시험할 수 있는데, 실제 "user" 에는 이미 제약이 걸려 있고 테스트 DB 사용자는 테이블 주인이 아니라 제약을 내릴
 * 수 없다. 그래서 같은 이름의 임시 테이블을 만들어(임시 스키마가 검색 경로 맨 앞이라 이름 없는 "user" 가 그 테이블을 가리킨다) 마이그레이션 파일을 그대로 돌려
 * 본다. 임시 테이블은 커밋 때 지워지고 @Transactional 롤백으로 아무것도 남지 않는다. 거절 확인은 실제 테이블에 한다.
 */
@Transactional
class UserEmailConstraintsMigrationTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;

  /** 평문 SQL 을 JDBC 로 그대로 실행한다 — jOOQ 평문 SQL 의 바인드·템플릿 해석({}·?)을 거치지 않게. 테스트 트랜잭션의 같은 커넥션. */
  private void execute(String sql) {
    dsl.connection(
        c -> {
          try (var st = c.createStatement()) {
            st.execute(sql);
          }
        });
  }

  /** 정리 전 상태의 임시 "user" 테이블을 만들고, 주어진 이메일들을 id 순서대로 심는다. */
  private void seedTempUsers(String... emails) {
    execute(
        "CREATE TEMP TABLE \"user\" (id bigint PRIMARY KEY, email varchar(255)) ON COMMIT DROP");
    dsl.connection(
        c -> {
          try (var ps =
              c.prepareStatement("INSERT INTO pg_temp.\"user\" (id, email) VALUES (?, ?)")) {
            for (int i = 0; i < emails.length; i++) {
              ps.setLong(1, i + 1);
              ps.setString(2, emails[i]);
              ps.addBatch();
            }
            ps.executeBatch();
          }
        });
  }

  /** V242 파일 전체를 임시 테이블에 돌린다. */
  private void runMigration() throws IOException {
    execute(
        new ClassPathResource("db/migration/V242__user_email_constraints.sql")
            .getContentAsString(StandardCharsets.UTF_8));
  }

  /** 임시 테이블의 id 별 이메일. */
  private String tempEmailOf(long id) {
    return (String) dsl.fetchValue("SELECT email FROM pg_temp.\"user\" WHERE id = ?", id);
  }

  /** 실제 "user" 테이블에 행을 심는다(거절 확인용). */
  private long seedUser(String email) {
    String username = "wp1156-" + UUID.randomUUID().toString().substring(0, 12);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, username)
        .set(USER.EMAIL, email)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void 탭_줄바꿈뿐인_이메일은_없음으로_바꾸고_보이는_글자가_있으면_둔다() throws IOException {
    seedTempUsers("\t", " \r\n ", "keep@ex.com", " keep2@ex.com ");

    runMigration();

    assertThat(tempEmailOf(1)).isNull();
    assertThat(tempEmailOf(2)).isNull();
    assertThat(tempEmailOf(3)).isEqualTo("keep@ex.com");
    assertThat(tempEmailOf(4)).isEqualTo(" keep2@ex.com ");
  }

  @Test
  void 대소문자만_다른_이메일은_가장_먼저_만든_계정만_남긴다() throws IOException {
    seedTempUsers("Dup@ex.com", "dup@ex.com", "DUP@EX.COM", "other@ex.com");

    runMigration();

    assertThat(tempEmailOf(1)).isEqualTo("Dup@ex.com");
    assertThat(tempEmailOf(2)).isNull();
    assertThat(tempEmailOf(3)).isNull();
    assertThat(tempEmailOf(4)).isEqualTo("other@ex.com");
  }

  // 실패한 문장 뒤에는 트랜잭션이 중단되므로 거절 확인은 테스트마다 하나씩 한다.
  @Test
  void 마이그레이션_뒤에는_탭_줄바꿈뿐인_이메일을_DB가_거절한다() {
    assertThatThrownBy(() -> seedUser("\t\n")).isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void 마이그레이션_뒤에는_빈_문자열_이메일을_DB가_거절한다() {
    assertThatThrownBy(() -> seedUser("")).isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void 마이그레이션_뒤에는_대소문자만_다른_이메일을_DB가_거절한다() {
    String base = "case-" + UUID.randomUUID().toString().substring(0, 8) + "@ex.com";
    seedUser(base);
    assertThatThrownBy(() -> seedUser(base.toUpperCase()))
        .isInstanceOf(DataIntegrityViolationException.class);
  }
}

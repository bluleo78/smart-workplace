package com.workplace.wiki.report;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.service.WikiSystemPageWriter;
import com.workplace.wiki.service.WikiSystemPageWriter.PersonalReportsHome;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 개인 보고 템플릿 동시 보장(WP-1486) — 같은 사람의 생성 둘이 동시에 {@link PersonalReportTemplate#ensure} 를 불러도 「보고」 아래
 * 템플릿은 종류마다 한 장이다(공간 트리 잠금 아래에서 설정을 다시 읽는다). 둘 다 같은 id 를 돌려받고, 그 페이지에는 기본 본문이 쓰여 있다.
 *
 * <p>두 스레드가 커밋된 데이터를 봐야 해서 비-@Transactional 이다. 테넌트 1 에 커밋하고 끝나면 지운다.
 */
class PersonalReportTemplateConcurrencyTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired PersonalReportTemplate template;
  @Autowired WikiSystemPageWriter writer;

  private long me;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(me);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(table(name("personal_report_setting")))
              .where(field(name("user_id"), Long.class).eq(me))
              .execute();
          dsl.deleteFrom(WIKI_SPACE)
              .where(WIKI_SPACE.OWNER_ID.eq(me))
              .and(WIKI_SPACE.TYPE.eq("PERSONAL"))
              .execute();
        });
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(me)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(me)).execute();
        });
    TenantContext.clear();
  }

  @Test
  void ensure_concurrent_oneTemplatePerKind() throws Exception {
    // 「보고」 자리는 미리 — 이 테스트는 템플릿 복사 경합만 본다(「보고」 만들기는 따로 트리 잠금을 쓴다).
    PersonalReportsHome home = writer.ensurePersonalReportsHome(me);
    for (PersonalReportKind kind : List.of(PersonalReportKind.DAILY, PersonalReportKind.WEEKLY)) {
      List<Long> ids = runTwice(() -> template.ensure(me, home, kind));
      assertThat(ids.get(0)).isEqualTo(ids.get(1));
    }

    List<String> titles =
        writer.childIdsOrdered(home.reportsPageId()).stream()
            .map(id -> writer.findPage(id).orElseThrow().title())
            .toList();
    assertThat(titles)
        .containsExactly(PersonalReportTemplate.DAILY_TITLE, PersonalReportTemplate.WEEKLY_TITLE);
    long daily = writer.childIdsOrdered(home.reportsPageId()).get(0);
    assertThat(writer.readBody(daily).orElse("")).contains("## 한 줄");
  }

  /** 같은 일을 두 스레드에서 한꺼번에 시작해 결과 둘을 모은다. */
  private List<Long> runTwice(java.util.concurrent.Callable<Long> body) throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<Long>> futures = new ArrayList<>();
    try {
      for (int i = 0; i < 2; i++) {
        futures.add(
            pool.submit(
                () -> {
                  TenantContext.set(1L);
                  try {
                    start.await();
                    return body.call();
                  } finally {
                    TenantContext.clear();
                  }
                }));
      }
      start.countDown();
      List<Long> ids = new ArrayList<>();
      for (Future<Long> f : futures) ids.add(f.get(60, TimeUnit.SECONDS));
      return ids;
    } finally {
      pool.shutdownNow();
    }
  }
}

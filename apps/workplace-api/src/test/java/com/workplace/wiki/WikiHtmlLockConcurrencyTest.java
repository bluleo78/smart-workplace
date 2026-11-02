package com.workplace.wiki;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreateHtmlPageRequest;
import com.workplace.wiki.exception.WikiHtmlLockedException;
import com.workplace.wiki.service.WikiHtmlLockService;
import com.workplace.wiki.service.WikiHtmlPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 「HTML 문서」 편집 잠금(WP-1308) — 여러 사람이 동시에 「편집」을 눌러도 정확히 한 사람만 잠금을 얻는다.
 *
 * <p>잠금 얻기는 한 문장의 조건부 upsert 다(먼저 읽고 넣는 방식이면 둘 다 「없음」을 보고 둘 다 얻는다). 각 요청이 자기 트랜잭션에서 커밋해야 하므로 테스트
 * 트랜잭션을 쓰지 않고 끝나면 만든 스페이스·사람을 지운다.
 */
class WikiHtmlLockConcurrencyTest extends IntegrationTestBase {
  private static final int EDITORS = 8;

  @Autowired WikiSpaceService spaceService;
  @Autowired WikiHtmlPageService htmlPageService;
  @Autowired WikiHtmlLockService lockService;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> editors = new ArrayList<>();
  private long spaceId;
  private long pageId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    long owner = user("owner");
    spaceId = spaceService.createTeamSpace(owner, "HTML동시잠금-" + UUID.randomUUID()).id();
    for (int i = 0; i < EDITORS; i++) {
      long id = user("editor" + i);
      spaceService.addMember(owner, spaceId, id, "EDITOR");
      editors.add(id);
    }
    pageId =
        htmlPageService
            .create(owner, spaceId, new CreateHtmlPageRequest(null, "동시", "<p>처음</p>"))
            .id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(spaceId)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
        });
    baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void 동시에_편집을_눌러도_한_사람만_잠금을_얻는다() throws Exception {
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(EDITORS);
    try {
      List<Future<Object>> results = new ArrayList<>();
      for (long editor : editors) {
        results.add(
            pool.submit(
                () -> {
                  TenantContext.set(1L);
                  try {
                    start.await(10, TimeUnit.SECONDS);
                    return lockService.acquire(editor, pageId);
                  } catch (Exception e) {
                    return e;
                  } finally {
                    TenantContext.clear();
                  }
                }));
      }
      start.countDown();
      int won = 0;
      int refused = 0;
      for (Future<Object> f : results) {
        Object r = f.get(30, TimeUnit.SECONDS);
        if (r instanceof WikiHtmlLockedException) {
          refused++;
        } else {
          assertThat(r).isNotInstanceOf(Exception.class);
          won++;
        }
      }
      assertThat(won).isEqualTo(1);
      assertThat(refused).isEqualTo(EDITORS - 1);
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  private long user(String prefix) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }
}

package com.workplace.wiki;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EVENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1066 V227 — 이미 쌓인 접근 요청 공유 기록의 설명에서 요청한 사람 이름을 빼는 데이터 정리. Flyway 가 이미 돌았으므로 마이그레이션 파일의 문장을 시드
 * 위에 다시 돌려 본다(같은 문장을 테스트한다 — AiMemoryCleanupMigrationTest 와 같은 방식). 롤백되는 트랜잭션이다.
 */
@Transactional
class WikiShareAccessRequestedDetailMigrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;

  /** V227 의 UPDATE 문장(주석 줄 빼고, 끝 세미콜론 제외). */
  private static String migrationSql() throws IOException {
    String all =
        new ClassPathResource("db/migration/V227__wiki_share_access_requested_detail.sql")
            .getContentAsString(StandardCharsets.UTF_8);
    String body =
        all.lines().filter(l -> !l.startsWith("--")).reduce("", (a, b) -> a + b + "\n").strip();
    return body.endsWith(";") ? body.substring(0, body.length() - 1) : body;
  }

  /** 테넌트 1 에 스페이스·페이지를 만들어 페이지 id 를 돌려준다. */
  private long seedPage(long ownerId) {
    dsl.execute("SELECT set_config('app.tenant_id', '1', true)");
    long spaceId =
        dsl.insertInto(WIKI_SPACE)
            .set(WIKI_SPACE.TYPE, "TEAM")
            .set(WIKI_SPACE.NAME, "V227 위키")
            .set(WIKI_SPACE.OWNER_ID, ownerId)
            .set(WIKI_SPACE.TENANT_ID, 1L)
            .returning(WIKI_SPACE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(WIKI_PAGE)
        .set(WIKI_PAGE.SPACE_ID, spaceId)
        .set(WIKI_PAGE.TITLE, "공유 대상")
        .set(WIKI_PAGE.TENANT_ID, 1L)
        .returning(WIKI_PAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 공유 기록 한 줄을 넣고 id 를 돌려준다. */
  private long insertEvent(long pageId, Long actorId, String type, String text) {
    return dsl.insertInto(WIKI_PAGE_SHARE_EVENT)
        .set(WIKI_PAGE_SHARE_EVENT.TENANT_ID, 1L)
        .set(WIKI_PAGE_SHARE_EVENT.PAGE_ID, pageId)
        .set(WIKI_PAGE_SHARE_EVENT.ACTOR_ID, actorId)
        .set(WIKI_PAGE_SHARE_EVENT.TYPE, type)
        .set(WIKI_PAGE_SHARE_EVENT.DETAIL, JSONB.valueOf("{\"text\": \"" + text + "\"}"))
        .returning(WIKI_PAGE_SHARE_EVENT.ID)
        .fetchOne()
        .getId();
  }

  private String text(long eventId) {
    return dsl.select(WIKI_PAGE_SHARE_EVENT.DETAIL)
        .from(WIKI_PAGE_SHARE_EVENT)
        .where(WIKI_PAGE_SHARE_EVENT.ID.eq(eventId))
        .fetchOne(WIKI_PAGE_SHARE_EVENT.DETAIL)
        .data()
        .replaceAll("^\\{\"text\": \"(.*)\"}$", "$1");
  }

  @Test
  void 행위자가_있는_옛_접근_요청_기록만_이름을_뺀다() throws IOException {
    long requester = TestFixtures.createHuman(dsl);
    long pageId = seedPage(TestFixtures.createHuman(dsl));
    long old = insertEvent(pageId, requester, "ACCESS_REQUESTED", "park사원 님이 접근을 요청했습니다");
    long already = insertEvent(pageId, requester, "ACCESS_REQUESTED", "접근을 요청했습니다");
    // 요청한 사람이 지워져 행위자가 빈 줄은 이름이 유일한 단서라 그대로 둔다.
    long orphan = insertEvent(pageId, null, "ACCESS_REQUESTED", "지운사람 님이 접근을 요청했습니다");
    // 승인 줄은 행위자(승인한 사람)와 대상(요청한 사람)이 달라 이름이 필요하다 — 건드리지 않는다.
    long approved = insertEvent(pageId, requester, "ACCESS_APPROVED", "park사원 님의 접근 요청을 승인했습니다");

    dsl.execute(migrationSql());

    assertThat(text(old)).isEqualTo("접근을 요청했습니다");
    assertThat(text(already)).isEqualTo("접근을 요청했습니다");
    assertThat(text(orphan)).isEqualTo("지운사람 님이 접근을 요청했습니다");
    assertThat(text(approved)).isEqualTo("park사원 님의 접근 요청을 승인했습니다");
  }
}

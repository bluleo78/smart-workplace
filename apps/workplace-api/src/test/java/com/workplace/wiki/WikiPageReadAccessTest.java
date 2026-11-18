package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER_GROUP;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiPageCard;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.service.WikiPageReadAccess;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 읽기 판정 포트(WP-1701) — 목록·검색과 같은 스페이스 실효 멤버십(직접·부서)으로 쿼리 한 번에 카드를 돌려주고, 기존 권한 판정
 * (effectiveAccess, 토큰 없음)과 어긋나지 않는다.
 */
@Transactional
class WikiPageReadAccessTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired WikiPageReadAccess access;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiShareAccess shareAccess;

  private long me;
  private long other;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
    other = withMembership(TestFixtures.createHuman(dsl));
  }

  private long space(long owner) {
    return spaceService.createTeamSpace(owner, "읽기판정-" + UUID.randomUUID()).id();
  }

  private long page(long owner, long spaceId, String title) {
    return pageService.create(owner, spaceId, new CreatePageRequest(null, title)).id();
  }

  @Test
  void readableCards_returnsOnlyMemberSpacePages() {
    long mine = space(other);
    spaceService.addMember(other, mine, me, "VIEWER");
    long p1 = page(other, mine, "내가 보는 노트");
    long foreign = space(other);
    long p2 = page(other, foreign, "남의 노트");

    Map<Long, WikiPageCard> cards = access.readableCards(me, List.of(p1, p2, 999_999_999L));
    assertThat(cards).containsOnlyKeys(p1);
  }

  @Test
  void readableCards_deptMemberCounts() {
    long sp = space(other);
    long p = page(other, sp, "부서 노트");
    long dept =
        dsl.insertInto(USER_GROUP)
            .set(USER_GROUP.NAME, "부서-" + UUID.randomUUID())
            .set(USER_GROUP.VISIBILITY, "SHARED")
            .returning(USER_GROUP.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, dept)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, me)
        .execute();
    assertThat(access.readableCards(me, List.of(p))).isEmpty();
    dsl.insertInto(WIKI_SPACE_MEMBER_GROUP)
        .set(WIKI_SPACE_MEMBER_GROUP.SPACE_ID, sp)
        .set(WIKI_SPACE_MEMBER_GROUP.GROUP_ID, dept)
        .set(WIKI_SPACE_MEMBER_GROUP.ROLE, "VIEWER")
        .execute();
    assertThat(access.readableCards(me, List.of(p))).containsOnlyKeys(p);
  }

  @Test
  void readableCards_otherTenantPage_excluded() {
    long tid2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tid2);
    long sp2 =
        dsl.insertInto(WIKI_SPACE)
            .set(WIKI_SPACE.NAME, "타테넌트")
            .set(WIKI_SPACE.TYPE, "TEAM")
            .set(WIKI_SPACE.OWNER_ID, other)
            .set(WIKI_SPACE.TENANT_ID, tid2)
            .returning(WIKI_SPACE.ID)
            .fetchOne()
            .getId();
    long p2 =
        dsl.insertInto(WIKI_PAGE)
            .set(WIKI_PAGE.SPACE_ID, sp2)
            .set(WIKI_PAGE.TITLE, "타테넌트 노트")
            .set(WIKI_PAGE.POSITION, 0)
            .set(WIKI_PAGE.TENANT_ID, tid2)
            .returning(WIKI_PAGE.ID)
            .fetchOne()
            .getId();
    useTenant(1L);
    assertThat(access.readableCards(me, List.of(p2))).isEmpty();
  }

  @Test
  void readableCards_fillsSpaceNameAndUpdatedByName() {
    long sp = space(other);
    spaceService.addMember(other, sp, me, "VIEWER");
    long p = page(other, sp, "카드");
    String spaceName =
        dsl.select(WIKI_SPACE.NAME)
            .from(WIKI_SPACE)
            .where(WIKI_SPACE.ID.eq(sp))
            .fetchOne(0, String.class);
    String otherName =
        dsl.select(USER.NAME).from(USER).where(USER.ID.eq(other)).fetchOne(0, String.class);

    dsl.update(WIKI_PAGE).set(WIKI_PAGE.UPDATED_BY, other).where(WIKI_PAGE.ID.eq(p)).execute();
    WikiPageCard card = access.readableCards(me, List.of(p)).get(p);
    assertThat(card.spaceName()).isEqualTo(spaceName);
    assertThat(card.spaceId()).isEqualTo(sp);
    assertThat(card.title()).isEqualTo("카드");
    assertThat(card.updatedByName()).isEqualTo(otherName);

    dsl.update(WIKI_PAGE).setNull(WIKI_PAGE.UPDATED_BY).where(WIKI_PAGE.ID.eq(p)).execute();
    assertThat(access.readableCards(me, List.of(p)).get(p).updatedByName()).isNull();
  }

  /** 새 포트와 기존 판정(effectiveAccess, 토큰 없음·VIEWER)이 같은 결론인지 — 멤버/비멤버/없는 공간 경우마다. */
  @Test
  void readableCards_matchesEffectiveAccessWithoutToken() {
    long mine = space(other);
    spaceService.addMember(other, mine, me, "VIEWER");
    long p1 = page(other, mine, "멤버");
    long foreign = space(other);
    long p2 = page(other, foreign, "비멤버");

    assertThat(access.readableCards(me, List.of(p1)).containsKey(p1)).isEqualTo(canRead(mine, p1));
    assertThat(access.readableCards(me, List.of(p2)).containsKey(p2))
        .isEqualTo(canRead(foreign, p2));
    // 없는 공간·페이지
    assertThat(access.readableCards(me, List.of(999_999_998L)).containsKey(999_999_998L))
        .isEqualTo(canRead(999_999_997L, 999_999_998L));
  }

  private boolean canRead(long spaceId, long pageId) {
    return assertThatCodeOk(() -> shareAccess.effectiveAccess(spaceId, pageId, me, null, "VIEWER"));
  }

  private static boolean assertThatCodeOk(Runnable r) {
    try {
      r.run();
      return true;
    } catch (RuntimeException e) {
      return false;
    }
  }

  @Test
  void requireReadable_unreadable_throwsPageNotFound() {
    long foreign = space(other);
    long p = page(other, foreign, "비밀");
    assertThatThrownBy(() -> access.requireReadable(me, p))
        .isInstanceOf(WikiPageNotFoundException.class);
    long mine = space(other);
    spaceService.addMember(other, mine, me, "VIEWER");
    long ok = page(other, mine, "열람");
    assertThatCode(() -> access.requireReadable(me, ok)).doesNotThrowAnyException();
  }
}

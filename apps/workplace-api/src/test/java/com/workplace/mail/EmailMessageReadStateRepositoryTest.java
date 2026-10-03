package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.UnreadAggregate;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** WP-187 읽음 상태 저장소 — 안읽음·보기 단위 일괄 읽음(asOf)·동기화 대상·조건부 해제. */
@Transactional
class EmailMessageReadStateRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;

  /** 적재·검증된 메일 한 통 — 수신 시각은 1시간 전, seen 은 인자대로, 분류는 category(null 이면 미분류). */
  private long fetched(long accountId, long folderId, String category, boolean seen) {
    ParsedMessage msg =
        new ParsedMessage(
            System.nanoTime(),
            "m-" + System.nanoTime(),
            "t-" + System.nanoTime(),
            null,
            null,
            "sender@example.com",
            null,
            null,
            null,
            "제목",
            Instant.now(),
            Instant.now(),
            false,
            false,
            null,
            null,
            "스니펫",
            List.of());
    long env = messageRepo.insertIgnoreConflict(accountId, folderId, msg).orElseThrow();
    Long content =
        dsl.select(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(env))
            .fetchOneInto(Long.class);
    contentRepo.updateBody(content, "본문", null, "스니펫");
    TestFixtures.markMailFetched(dsl, env);
    if (category != null) {
      dsl.update(EMAIL_CONTENT)
          .set(EMAIL_CONTENT.AI_CATEGORY, category)
          .where(EMAIL_CONTENT.ID.eq(content))
          .execute();
    }
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, seen)
        .set(EMAIL_MESSAGE.RECEIVED_AT, OffsetDateTime.now().minusHours(1))
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    return env;
  }

  /**
   * asOf 기준 시각 — DB 시계(now() = 트랜잭션 시작)를 쓴다. created_at 도 DB now() 라 JVM 시계를 쓰면 컨테이너 DB 와의 시계 차이로
   * 방금 넣은 행이 asOf 뒤로 판정될 수 있다(서비스도 asOf 를 DB 시각으로 잡아야 한다).
   */
  private OffsetDateTime dbNow() {
    return dsl.select(DSL.currentOffsetDateTime()).fetchOne(0, OffsetDateTime.class);
  }

  private boolean seen(long id) {
    return dsl.select(EMAIL_MESSAGE.SEEN)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne(EMAIL_MESSAGE.SEEN);
  }

  private boolean pending(long id) {
    return dsl.select(EMAIL_MESSAGE.SEEN_PUSH_PENDING)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(id))
        .fetchOne(EMAIL_MESSAGE.SEEN_PUSH_PENDING);
  }

  @Test
  void markUnseen_onlyFromSeen_setsPending() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs1-" + System.nanoTime() + "@test.local");
    long read = fetched(box[1], box[2], "업무", true);
    long unread = fetched(box[1], box[2], "업무", false);

    assertThat(messageRepo.markUnseen(read)).isEqualTo(1);
    assertThat(messageRepo.markUnseen(unread)).isZero();
    assertThat(seen(read)).isFalse();
    assertThat(pending(read)).isTrue();
  }

  @Test
  void markAllSeenInView_workView_respectsAsOf_andOtherCategories() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs2-" + System.nanoTime() + "@test.local");
    long work = fetched(box[1], box[2], "업무", false);
    long none = fetched(box[1], box[2], null, false);
    long personal = fetched(box[1], box[2], "개인", false);
    OffsetDateTime asOf = dbNow();
    // 수신 시각만 asOf 뒤(발신자 Date 헤더 등 미래 시각)이고 asOf 이전에 적재된 메일 — 경계는 적재 시각만 보므로 포함된다
    long futureReceived = fetched(box[1], box[2], "업무", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.RECEIVED_AT, asOf.plusMinutes(1))
        .where(EMAIL_MESSAGE.ID.eq(futureReceived))
        .execute();
    // 수신 시각은 과거여도 다이얼로그 뒤 동기화로 이 DB 에 들어온 메일
    long lateCreated = fetched(box[1], box[2], "업무", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.CREATED_AT, asOf.plusMinutes(1))
        .where(EMAIL_MESSAGE.ID.eq(lateCreated))
        .execute();

    assertThat(messageRepo.countUnreadInView(box[1], "업무", false, null, asOf)).isEqualTo(3);
    List<Long> ids = messageRepo.markAllSeenInView(box[1], "업무", false, null, asOf);

    assertThat(ids).containsExactlyInAnyOrder(work, none, futureReceived);
    assertThat(seen(work)).isTrue();
    assertThat(pending(work)).isTrue();
    assertThat(seen(personal)).isFalse();
    assertThat(seen(futureReceived)).isTrue();
    assertThat(seen(lateCreated)).isFalse();
  }

  @Test
  void markAllSeenInView_nullReceivedAt_included() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs2n-" + System.nanoTime() + "@test.local");
    long noTime = fetched(box[1], box[2], "업무", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.RECEIVED_AT, (OffsetDateTime) null)
        .where(EMAIL_MESSAGE.ID.eq(noTime))
        .execute();

    assertThat(messageRepo.markAllSeenInView(box[1], "업무", false, null, dbNow()))
        .containsExactly(noTime);
  }

  @Test
  void markAllSeenInView_otherAccount_untouched() {
    long[] mine = TestFixtures.seedMailbox(dsl, "rs3a-" + System.nanoTime() + "@test.local");
    long[] other = TestFixtures.seedMailbox(dsl, "rs3b-" + System.nanoTime() + "@test.local");
    long theirs = fetched(other[1], other[2], "업무", false);

    messageRepo.markAllSeenInView(mine[1], "업무", false, null, dbNow());

    assertThat(seen(theirs)).isFalse();
  }

  @Test
  void markAllSeenInView_sentFolder_excluded() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs5-" + System.nanoTime() + "@test.local");
    long sentFolder =
        dsl.insertInto(
                EMAIL_FOLDER, EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME, EMAIL_FOLDER.TENANT_ID)
            .values(box[1], "SENT", 1L)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    long sent = fetched(box[1], sentFolder, "업무", false);
    long inbox = fetched(box[1], box[2], "업무", false);

    assertThat(messageRepo.markAllSeenInView(box[1], "업무", false, null, dbNow()))
        .containsExactly(inbox);
    assertThat(seen(sent)).isFalse();
  }

  @Test
  void markAllSeenInView_needsReplyView_onlyNeedsReply() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs6-" + System.nanoTime() + "@test.local");
    long reply = fetched(box[1], box[2], "업무", false);
    long plain = fetched(box[1], box[2], "업무", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, true)
        .where(EMAIL_MESSAGE.ID.eq(reply))
        .execute();
    OffsetDateTime asOf = dbNow();

    assertThat(messageRepo.countUnreadInView(box[1], null, true, null, asOf)).isEqualTo(1);
    assertThat(messageRepo.markAllSeenInView(box[1], null, true, null, asOf))
        .containsExactly(reply);
    assertThat(seen(plain)).isFalse();
  }

  @Test
  void markAllSeenInView_queryView_onlyMatching() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs7-" + System.nanoTime() + "@test.local");
    long hit = fetched(box[1], box[2], "업무", false);
    long miss = fetched(box[1], box[2], "업무", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FROM_ADDRESS, "needle-sender@example.com")
        .where(EMAIL_MESSAGE.ID.eq(hit))
        .execute();

    assertThat(messageRepo.markAllSeenInView(box[1], null, false, "needle", dbNow()))
        .containsExactly(hit);
    assertThat(seen(miss)).isFalse();
  }

  @Test
  void countUnreadInView_matchesSidebarAggregate() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs8-" + System.nanoTime() + "@test.local");
    fetched(box[1], box[2], "업무", false);
    fetched(box[1], box[2], null, false);
    fetched(box[1], box[2], "개인", false);
    fetched(box[1], box[2], "알림", true); // 읽음 — 세지 않음
    long reply = fetched(box[1], box[2], "프로모션", false);
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, true)
        .where(EMAIL_MESSAGE.ID.eq(reply))
        .execute();
    OffsetDateTime asOf = dbNow();

    UnreadAggregate agg = messageRepo.countUnreadAggregate(box[1]);

    assertThat(messageRepo.countUnreadInView(box[1], "업무", false, null, asOf))
        .isEqualTo(agg.byCategory().get("업무"));
    for (String c : EmailMessageRepository.CATEGORIES) {
      assertThat(messageRepo.countUnreadInView(box[1], c, false, null, asOf))
          .as(c)
          .isEqualTo(agg.byCategory().get(c));
    }
    assertThat(messageRepo.countUnreadInView(box[1], null, false, null, asOf))
        .isEqualTo(agg.inbox());
    assertThat(messageRepo.countUnreadInView(box[1], null, true, null, asOf))
        .isEqualTo(agg.needsReply());
  }

  @Test
  void pendingItems_carryCurrentSeen_andConditionalClear() {
    long[] box = TestFixtures.seedMailbox(dsl, "rs4-" + System.nanoTime() + "@test.local");
    long id = fetched(box[1], box[2], "업무", false);
    messageRepo.markSeen(id);

    List<SeenSyncItem> items = messageRepo.findPendingSeenSyncItems(List.of(id));
    assertThat(items).singleElement().satisfies(it -> assertThat(it.seen()).isTrue());

    // 그 사이 사용자가 안읽음으로 되돌림 → true 로 보낸 결과로는 해제하지 않는다
    messageRepo.markUnseen(id);
    assertThat(messageRepo.clearSeenPushPendingIf(id, true)).isZero();
    assertThat(pending(id)).isTrue();
    assertThat(messageRepo.clearSeenPushPendingIf(id, false)).isEqualTo(1);
    assertThat(pending(id)).isFalse();
    // 대기가 풀린 행은 동기화 대상에서 빠진다
    assertThat(messageRepo.findPendingSeenSyncItems(List.of(id))).isEmpty();
  }
}

package com.workplace.file.api;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.file.api.StagedFileClaimer.Retention;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 스테이징 파일 클레임(WP-421) 통합 테스트 — 호출자 소유·ATTACHMENT·살아 있는 임시 파일만 클레임되고, 어느 도메인 정션에든 이미 묶인 파일은 거절되며, 같은
 * 파일을 동시에 두 번 영구 클레임하면 하나만 성공하는지 본다.
 *
 * <p>파일은 FILE 에 직접 INSERT 해 시드한다(디스크 blob 은 클레임과 무관). 테넌트#1 테스트 트랜잭션 안에서 돌고 롤백된다 — 동시성 테스트만 트랜잭션
 * 밖에서 커밋하고 직접 정리한다.
 */
@Transactional
class StagedFileClaimerTest extends IntegrationTestBase {

  @Autowired private StagedFileClaimer claimer;
  @Autowired private DSLContext dsl;

  private long me;

  @BeforeEach
  void setUp() {
    // 동시성 테스트(NOT_SUPPORTED)는 테스트 트랜잭션이 없어 시드를 직접 커밋하므로 여기서는 만들지 않는다.
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      me = TestFixtures.createHuman(dsl);
    }
  }

  /** 내 임시 ATTACHMENT 를 PERMANENT 로 클레임하면 돌려받고 만료가 지워진다(영구 파일). */
  @Test
  void claim_내_임시_ATTACHMENT_는_PERMANENT_로_영구가_된다() {
    long fileId = seedFile(me, "ATTACHMENT", OffsetDateTime.now().plusHours(24));

    List<StagedFile> claimed = claimer.claim(me, List.of(fileId), Retention.PERMANENT);

    assertThat(claimed).hasSize(1);
    StagedFile f = claimed.get(0);
    assertThat(f.fileId()).isEqualTo(fileId);
    assertThat(f.originalName()).isEqualTo("a.txt");
    assertThat(f.mimeType()).isEqualTo("text/plain");
    assertThat(f.sizeBytes()).isEqualTo(3L);
    assertThat(f.storagePath()).isEqualTo("tenant-1/staged/" + fileId);
    assertThat(expiresAt(fileId)).isNull();
  }

  /** KEEP_TEMPORARY 는 만료를 그대로 둔다(노트처럼 묶은 뒤에도 임시로 두는 도메인). 입력 순서대로 돌려준다. */
  @Test
  void claim_KEEP_TEMPORARY_는_만료를_그대로_둔다() {
    OffsetDateTime exp = OffsetDateTime.now().plusHours(24);
    long a = seedFile(me, "ATTACHMENT", exp);
    long b = seedFile(me, "ATTACHMENT", exp);

    List<StagedFile> claimed = claimer.claim(me, List.of(b, a), Retention.KEEP_TEMPORARY);

    assertThat(claimed).extracting(StagedFile::fileId).containsExactly(b, a);
    assertThat(expiresAt(a)).isNotNull();
    assertThat(expiresAt(b)).isNotNull();
  }

  /** 남의 파일·영구 파일·만료된 파일·다른 카테고리·없는 파일은 모두 같은 예외, 그 id 가 담긴다. 앞선 정상 파일은 영구가 되지 않는다. */
  @Test
  void claim_남의_파일_영구_파일_만료_파일_다른_카테고리는_같은_예외() {
    long other = TestFixtures.createHuman(dsl);
    OffsetDateTime future = OffsetDateTime.now().plusHours(24);
    long ok = seedFile(me, "ATTACHMENT", future);
    long othersFile = seedFile(other, "ATTACHMENT", future);
    long permanent = seedFile(me, "ATTACHMENT", null);
    long expired = seedFile(me, "ATTACHMENT", OffsetDateTime.now().minusMinutes(1));
    long image = seedFile(me, "IMAGE", future);
    long missing = Long.MAX_VALUE;

    for (long bad : new long[] {othersFile, permanent, expired, image, missing}) {
      assertThatThrownBy(() -> claimer.claim(me, List.of(ok, bad), Retention.PERMANENT))
          .isInstanceOfSatisfying(
              StagedFileUnusableException.class, e -> assertThat(e.fileId()).isEqualTo(bad));
    }
    assertThat(expiresAt(ok)).isNotNull();
  }

  /** 노트(강등 행 포함)·채널 메시지·이슈·이슈 채팅·홈 채팅 정션에 묶인 임시 파일은 거절 — 다섯 lookup 각각. */
  @Test
  void claim_노트에_묶인_임시_파일은_거절() {
    OffsetDateTime future = OffsetDateTime.now().plusHours(24);

    // 노트 — 강등(demoted) 행도 묶인 것으로 본다.
    long wikiFile = seedFile(me, "ATTACHMENT", future);
    long spaceId =
        dsl.insertInto(WIKI_SPACE)
            .set(WIKI_SPACE.TYPE, "TEAM")
            .set(WIKI_SPACE.NAME, "클레임 공간")
            .set(WIKI_SPACE.OWNER_ID, me)
            .set(WIKI_SPACE.TENANT_ID, 1L)
            .returning(WIKI_SPACE.ID)
            .fetchOne()
            .getId();
    long pageId =
        dsl.insertInto(WIKI_PAGE)
            .set(WIKI_PAGE.SPACE_ID, spaceId)
            .set(WIKI_PAGE.TITLE, "클레임 페이지")
            .set(WIKI_PAGE.TENANT_ID, 1L)
            .returning(WIKI_PAGE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.FILE_ID, wikiFile)
        .set(WIKI_PAGE_ATTACHMENT.PAGE_ID, pageId)
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_BY, me)
        .set(WIKI_PAGE_ATTACHMENT.DEMOTED_AT, OffsetDateTime.now())
        .execute();

    // 채널 메시지
    long messageFile = seedFile(me, "ATTACHMENT", future);
    long channelId =
        dsl.insertInto(CHANNEL)
            .set(CHANNEL.KIND, "CHANNEL")
            .set(CHANNEL.VISIBILITY, "PUBLIC")
            .set(CHANNEL.CREATED_BY, me)
            .set(CHANNEL.TENANT_ID, 1L)
            .returning(CHANNEL.ID)
            .fetchOne()
            .getId();
    long messageId =
        dsl.insertInto(MESSAGE)
            .set(MESSAGE.CHANNEL_ID, channelId)
            .set(MESSAGE.AUTHOR_ID, me)
            .set(MESSAGE.BODY, "첨부")
            .set(MESSAGE.TENANT_ID, 1L)
            .returning(MESSAGE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MESSAGE_ATTACHMENT)
        .set(MESSAGE_ATTACHMENT.FILE_ID, messageFile)
        .set(MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();

    // 이슈
    long issueFile = seedFile(me, "ATTACHMENT", future);
    long issueId = seedIssue(me);
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, issueFile)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issueId)
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, me)
        .execute();

    // 이슈 채팅
    long chatFile = seedFile(me, "ATTACHMENT", future);
    long threadId =
        dsl.insertInto(CHAT_THREAD)
            .set(CHAT_THREAD.ISSUE_ID, issueId)
            .returning(CHAT_THREAD.ID)
            .fetchOne()
            .getId();
    long chatMessageId =
        dsl.insertInto(CHAT_MESSAGE)
            .set(CHAT_MESSAGE.THREAD_ID, threadId)
            .set(CHAT_MESSAGE.AUTHOR_ID, me)
            .set(CHAT_MESSAGE.BODY, "첨부")
            .returning(CHAT_MESSAGE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(CHAT_MESSAGE_ATTACHMENT)
        .set(CHAT_MESSAGE_ATTACHMENT.FILE_ID, chatFile)
        .set(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID, chatMessageId)
        .set(CHAT_MESSAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();

    // 홈 채팅
    long homeFile = seedFile(me, "ATTACHMENT", future);
    UUID sessionId =
        dsl.insertInto(HOME_SESSION)
            .set(HOME_SESSION.USER_ID, me)
            .returning(HOME_SESSION.ID)
            .fetchOne()
            .getId();
    long homeMessageId =
        dsl.insertInto(HOME_MESSAGE)
            .set(HOME_MESSAGE.SESSION_ID, sessionId)
            .set(HOME_MESSAGE.ROLE, "USER")
            .set(HOME_MESSAGE.CONTENT, "첨부")
            .returning(HOME_MESSAGE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(HOME_MESSAGE_ATTACHMENT)
        .set(HOME_MESSAGE_ATTACHMENT.FILE_ID, homeFile)
        .set(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, homeMessageId)
        .set(HOME_MESSAGE_ATTACHMENT.ATTACHED_BY, me)
        .execute();

    for (long bound : new long[] {wikiFile, messageFile, issueFile, chatFile, homeFile}) {
      for (Retention retention : Retention.values()) {
        assertThatThrownBy(() -> claimer.claim(me, List.of(bound), retention))
            .isInstanceOfSatisfying(
                StagedFileUnusableException.class, e -> assertThat(e.fileId()).isEqualTo(bound));
      }
      assertThat(expiresAt(bound)).isNotNull();
    }
  }

  /**
   * 바인딩 지목(다시 가져오기) — 보류 클레임이 지목한 바인딩이 다시 가져오게 한 파일만 받는다. 지목하지 않았거나 다른 바인딩을 지목하면 거절, 지목한 바인딩 말고 다른
   * 바인딩에도 묶였으면 거절, 영구·임시 유지 클레임은 지목할 수 없다(형태 오류).
   */
  @Test
  void claim_지목한_바인딩의_묶임만_건너뛰고_다른_바인딩에도_묶였으면_거절() {
    OffsetDateTime future = OffsetDateTime.now().plusHours(24);
    long mineBound = seedFile(me, "ATTACHMENT", null); // A 에 묶여 영구
    long alsoElsewhere = seedFile(me, "ATTACHMENT", null); // A 와 B 모두에 묶임
    long free = seedFile(me, "ATTACHMENT", future);
    AttachmentBindingLookup a =
        fakeLookup("a", Set.of(mineBound, alsoElsewhere), Set.of(mineBound, alsoElsewhere));
    AttachmentBindingLookup b = fakeLookup("b", Set.of(alsoElsewhere), Set.of());
    StagedFileClaimer scoped = new StagedFileClaimer(dsl, List.of(a, b));

    assertThat(scoped.requireClaimable(me, List.of(mineBound, free), Retention.HOLD, "a"))
        .hasSize(2);
    assertThat(scoped.claim(me, List.of(mineBound), Retention.HOLD, "a")).hasSize(1);
    scoped.releaseHeld(me, scoped.requireClaimable(me, List.of(free), Retention.HOLD, "a"));

    // 지목 없음·다른 바인딩 지목 → 묶인 파일로 거절
    for (String key : new String[] {null, "b", "없는 바인딩"}) {
      long target = seedFile(me, "ATTACHMENT", null);
      StagedFileClaimer only =
          new StagedFileClaimer(dsl, List.of(fakeLookup("a", Set.of(target), Set.of(target))));
      assertThatThrownBy(() -> only.claim(me, List.of(target), Retention.HOLD, key))
          .isInstanceOfSatisfying(
              StagedFileUnusableException.class, e -> assertThat(e.fileId()).isEqualTo(target));
    }
    // 지목한 바인딩이 내줘도 다른 바인딩(B)에 묶였으면 거절
    assertThatThrownBy(() -> scoped.claim(me, List.of(alsoElsewhere), Retention.HOLD, "a"))
        .isInstanceOfSatisfying(
            StagedFileUnusableException.class,
            e -> assertThat(e.fileId()).isEqualTo(alsoElsewhere));
    // 영구·임시 유지는 지목할 수 없다
    for (Retention r : new Retention[] {Retention.PERMANENT, Retention.KEEP_TEMPORARY}) {
      assertThatThrownBy(() -> scoped.claim(me, List.of(free), r, "a"))
          .isInstanceOf(IllegalArgumentException.class);
      assertThatThrownBy(() -> scoped.requireClaimable(me, List.of(free), r, "a"))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }

  /** 테스트용 바인딩 — 키·묶인 id·다시 가져올 수 있는 id 를 고정한다. */
  private static AttachmentBindingLookup fakeLookup(
      String key, Set<Long> bound, Set<Long> reclaimable) {
    return new AttachmentBindingLookup() {
      @Override
      public String bindingKey() {
        return key;
      }

      @Override
      public Set<Long> boundAmong(Collection<Long> fileIds) {
        return bound.stream().filter(fileIds::contains).collect(Collectors.toSet());
      }

      @Override
      public Set<Long> reclaimableBy(long callerId, Collection<Long> fileIds) {
        return reclaimable.stream().filter(fileIds::contains).collect(Collectors.toSet());
      }
    };
  }

  /** 같은 id 가 두 번·빈 값은 형태 오류(IllegalArgumentException → 400) — 잠그거나 고치기 전에 거른다. */
  @Test
  void claim_중복_id_는_거절() {
    long fileId = seedFile(me, "ATTACHMENT", OffsetDateTime.now().plusHours(24));

    assertThatThrownBy(() -> claimer.claim(me, List.of(fileId, fileId), Retention.PERMANENT))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> claimer.claim(me, Arrays.asList(fileId, null), Retention.PERMANENT))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(expiresAt(fileId)).isNotNull();
    assertThat(claimer.claim(me, List.of(), Retention.PERMANENT)).isEmpty();
  }

  /**
   * 같은 임시 파일을 두 트랜잭션이 동시에 PERMANENT 클레임하면 하나만 성공한다 — FOR UPDATE 로 줄 세운 뒤 두 번째는 만료가 이미 지워진 행을 보고
   * 거절된다. 실제 커밋이 필요해 테스트 트랜잭션 밖에서 돌고, 시드는 직접 정리한다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void claim_동시에_두_번이면_하나만_성공() throws Exception {
    long[] seeded = new long[2];
    inTenantTx(
        () -> {
          seeded[0] = TestFixtures.createHuman(dsl);
          seeded[1] = seedFile(seeded[0], "ATTACHMENT", OffsetDateTime.now().plusHours(24));
        });
    long owner = seeded[0];
    long fileId = seeded[1];

    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<String>> results = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        results.add(
            pool.submit(
                () -> {
                  start.await();
                  try {
                    inTenantTx(() -> claimer.claim(owner, List.of(fileId), Retention.PERMANENT));
                    return "OK";
                  } catch (StagedFileUnusableException e) {
                    return "UNUSABLE:" + e.fileId();
                  }
                }));
      }
      start.countDown();
      List<String> outcomes = new ArrayList<>();
      for (Future<String> f : results) {
        outcomes.add(f.get(60, TimeUnit.SECONDS));
      }
      assertThat(outcomes).containsExactlyInAnyOrder("OK", "UNUSABLE:" + fileId);
    } finally {
      pool.shutdownNow();
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId)).execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(owner)).execute();
          });
    }
  }

  /** 토큰 도우미 — 접두를 지키고 base62 본문을 붙이며, 같은 입력의 해시는 같고 64자리 소문자 hex 다. */
  @Nested
  class CapabilityTokensTest {

    @Test
    void CapabilityTokens_같은_입력은_같은_해시_접두를_지킨다() {
      String t1 = CapabilityTokens.generate("su_");
      String t2 = CapabilityTokens.generate("su_");

      assertThat(t1).startsWith("su_").matches("su_[0-9A-Za-z]{30,}");
      assertThat(t1).isNotEqualTo(t2);
      assertThat(CapabilityTokens.sha256Hex(t1))
          .isEqualTo(CapabilityTokens.sha256Hex(t1))
          .matches("[0-9a-f]{64}");
      assertThat(CapabilityTokens.sha256Hex("abc"))
          .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 시드 도우미
  // ---------------------------------------------------------------------------------------------

  /** FILE 행 직접 시드 — 클레임은 행 상태만 보므로 blob 은 만들지 않는다. */
  private long seedFile(long uploader, String category, OffsetDateTime expiresAt) {
    String stored = "staged-" + UUID.randomUUID();
    long id =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, stored)
            .set(FILE.STORAGE_PATH, stored)
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.CATEGORY, category)
            .set(FILE.UPLOADED_BY, uploader)
            .set(FILE.EXPIRES_AT, expiresAt)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    // storage_path 를 id 로 다시 써 StagedFile 매핑을 결정적으로 단언한다.
    dsl.update(FILE)
        .set(FILE.STORAGE_PATH, "tenant-1/staged/" + id)
        .where(FILE.ID.eq(id))
        .execute();
    return id;
  }

  /** 이슈 1건(프로젝트·유형 포함) 시드 — 이슈 첨부·이슈 채팅 정션의 부모. */
  private long seedIssue(long reporter) {
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "SFC" + (System.nanoTime() % 100000))
            .set(PROJECT.NAME, "클레임 프로젝트")
            .set(PROJECT.OWNER_ID, reporter)
            .set(PROJECT.TENANT_ID, 1L)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "클레임 이슈")
        .set(ISSUE.STATUS, "TODO")
        .set(ISSUE.PRIORITY, "MID")
        .set(ISSUE.REPORTER_ID, reporter)
        .set(ISSUE.TYPE_ID, typeId)
        .set(ISSUE.TENANT_ID, 1L)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  private OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  /** 테넌트#1 GUC 가 실린 커밋 트랜잭션 — 동시성 테스트의 시드와 각 스레드의 클레임이 쓴다. */
  private void inTenantTx(Runnable body) {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager).executeWithoutResult(s -> body.run());
    } finally {
      TenantContext.clear();
    }
  }
}

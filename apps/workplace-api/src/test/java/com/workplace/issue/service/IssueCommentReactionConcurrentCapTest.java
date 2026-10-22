package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueCommentReactionRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 코멘트 반응 상한이 동시 요청에도 지켜지는지(WP-829) — 채팅 반응(WP-778, ReactionConcurrentCapTest)과 같은 경합. 고치기 전에는 동시
 * 요청이 모두 「상한 미만」으로 읽고 함께 삽입해 1인 20개·종류 50종을 넘겼다. 요청마다 커밋되는 트랜잭션이 필요해 클래스에 {@code @Transactional} 을
 * 쓰지 않고, 시드는 테넌트#1 트랜잭션 안에서 넣는다(트랜잭션 밖 쓰기는 풀 커넥션의 세션 GUC 를 따라가므로 — WP-827).
 */
class IssueCommentReactionConcurrentCapTest extends IntegrationTestBase {

  @Autowired IssueCommentReactionService reactionService;
  @Autowired IssueCommentReactionRepository reactionRepository;
  @Autowired IssueCommentRepository commentRepository;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  private final List<Long> users = new ArrayList<>();
  private OpenScenario.Result s;
  private long commentId;

  @BeforeEach
  void seed() {
    s =
        inTenant(
            () ->
                OpenScenario.create(
                    dsl, issueTypeService, issueRepository, sequenceRepository, 1L));
    users.addAll(List.of(s.ownerId(), s.memberId(), s.reporterId(), s.strangerId()));
    commentId = inTenant(() -> commentRepository.insert(s.issueId(), s.ownerId(), "코멘트").id());
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          // 이슈를 지우면 코멘트·반응이 CASCADE 로 함께 지워진다.
          dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(s.project().id())).execute();
          dsl.deleteFrom(PROJECT_MEMBER)
              .where(PROJECT_MEMBER.PROJECT_ID.eq(s.project().id()))
              .execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(s.project().id())).execute();
        });
    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
  }

  /**
   * 19개를 단 사람이 20번째와 21번째를 동시에 보내면 하나만 저장된다. 앞 요청이 20번째를 넣고 커밋하기 전에 뒷 요청이 상한을 확인하게 만들어(앞 트랜잭션을 잠시
   * 열어 둔다) 경합을 매번 재현한다. 고치기 전에는 뒷 요청이 커밋 안 된 20번째를 못 보고 19개로 읽어 21개가 됐다.
   */
  @Test
  void 한_사람의_20번째와_21번째_반응이_겹쳐도_20개에서_멈춘다() throws Exception {
    inTenant(
        () -> {
          for (int i = 0; i < 19; i++) reactionRepository.add(commentId, s.memberId(), emojiAt(i));
          return null;
        });

    boolean secondAccepted = race(s.memberId(), emojiAt(19), s.memberId(), emojiAt(20));

    assertThat(secondAccepted).isFalse();
    assertThat(inTenant(() -> reactionRepository.countByUser(commentId, s.memberId())))
        .isEqualTo(20);
  }

  /** 49종이 달린 코멘트에 두 사람이 새 이모지를 동시에 달면 하나만 저장돼 50종에서 멈춘다(위와 같은 방식으로 경합을 매번 재현). */
  @Test
  void 두_사람이_50번째와_51번째_이모지를_겹쳐_달아도_50종에서_멈춘다() throws Exception {
    // 49종을 미리 단다 — 세 사람이 나눠서(1인 20개 상한 안). 저장소로 바로 넣어 서비스 상한과 무관하게 시드한다.
    long[] seeders = {s.ownerId(), s.memberId(), addProjectMember()};
    inTenant(
        () -> {
          for (int i = 0; i < 49; i++)
            reactionRepository.add(commentId, seeders[i / 17], emojiAt(i));
          return null;
        });

    boolean secondAccepted = race(addProjectMember(), emojiAt(49), addProjectMember(), emojiAt(50));

    assertThat(secondAccepted).isFalse();
    assertThat(inTenant(() -> reactionRepository.countDistinctEmojis(commentId))).isEqualTo(50);
  }

  /**
   * 앞 요청(first)은 트랜잭션을 열어 반응을 넣은 뒤 잠시 커밋하지 않고, 그동안 뒷 요청(second)이 자기 트랜잭션으로 반응을 시도한다. 앞 요청은 늘 저장돼야
   * 하고, 뒷 요청이 저장됐는지(상한 400 이면 false)를 돌려준다.
   */
  private boolean race(long firstUser, String firstEmoji, long secondUser, String secondEmoji)
      throws Exception {
    CountDownLatch firstAdded = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> first =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            reactionService.add(firstUser, s.issueId(), commentId, firstEmoji);
                            firstAdded.countDown();
                            try {
                              // 뒷 요청이 상한을 확인할 동안 커밋하지 않고 버틴다.
                              Thread.sleep(800);
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      assertThat(firstAdded.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Boolean> second = pool.submit(() -> tryAdd(secondUser, secondEmoji));
      first.get(30, TimeUnit.SECONDS);
      return second.get(30, TimeUnit.SECONDS);
    } finally {
      pool.shutdownNow();
    }
  }

  /** 반응 추가를 시도해 저장 허용이면 true, 상한(400)이면 false. 요청처럼 테넌트를 잡고 서비스 트랜잭션으로 커밋한다. */
  private boolean tryAdd(long userId, String emoji) {
    TenantContext.set(1L);
    try {
      reactionService.add(userId, s.issueId(), commentId, emoji);
      return true;
    } catch (IllegalArgumentException e) {
      return false;
    } finally {
      TenantContext.clear();
    }
  }

  /** 프로젝트 MEMBER 인 사람을 하나 더 시드한다(반응 작성 권한이 있다). */
  private long addProjectMember() {
    long id =
        inTenant(
            () -> {
              String suffix = UUID.randomUUID().toString().substring(0, 8);
              long userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rxc-" + suffix)
                      .set(USER.PASSWORD, "pw")
                      .set(USER.NAME, "rxc")
                      .set(USER.EMAIL, "rxc-" + suffix + "@example.com")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(PROJECT_MEMBER)
                  .set(PROJECT_MEMBER.PROJECT_ID, s.project().id())
                  .set(PROJECT_MEMBER.USER_ID, userId)
                  .set(PROJECT_MEMBER.ROLE, "MEMBER")
                  .execute();
              return userId;
            });
    users.add(id);
    return id;
  }

  /** 0x1F600(😀)부터 i 번째 이모지. */
  private static String emojiAt(int i) {
    return new String(Character.toChars(0x1F600 + i));
  }

  /** 테넌트#1 트랜잭션 안에서 실행한다(커밋). */
  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(1L);
    try {
      return new TransactionTemplate(txManager).execute(status -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}

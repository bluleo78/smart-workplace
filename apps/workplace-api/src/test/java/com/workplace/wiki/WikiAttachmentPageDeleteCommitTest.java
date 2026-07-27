package com.workplace.wiki;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.tables.File.FILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WikiPageService.delete() 가 페이지 서브트리의 첨부를 실제로 회수(#757)하는지 검증하는 전용 테스트.
 *
 * <p>비-@Transactional (WikiAttachmentDeleteCommitTest 와 동일 이유): {@code
 * TransactionSynchronization.afterCommit} 은 실제 커밋에서만 발화하므로, 롤백되는 테스트 트랜잭션 안에서는 구현이 {@code
 * afterCompletion} 으로 잘못 쓰이거나 등록만 하고 실행을 빼먹어도 초록이 되어버린다. 정리는 자기-id {@code @AfterEach} 로 직접 수행한다.
 */
class WikiAttachmentPageDeleteCommitTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;
  @Autowired PlatformTransactionManager txManager;

  private final List<Long> seededUserIds = new ArrayList<>();
  private final List<Long> seededFileIds = new ArrayList<>();

  private long seededSpaceId = -1;

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          // 해피패스면 이미 없으므로 no-op, 테스트 바디가 중간에 실패했을 때만 실제로 지우는 백스톱.
          if (!seededFileIds.isEmpty()) {
            dsl.deleteFrom(FILE).where(FILE.ID.in(seededFileIds)).execute();
          }
          if (seededSpaceId != -1) {
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(seededSpaceId)).execute();
          }
          if (!seededUserIds.isEmpty()) {
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
          }
        });
    seededUserIds.clear();
    seededFileIds.clear();
    seededSpaceId = -1;
  }

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    seededUserIds.add(id);
    return id;
  }

  private byte[] png() {
    return new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0};
  }

  @Test
  void 부모_페이지_삭제_시_손자까지_전_서브트리_첨부가_회수되어_디스크에서_사라진다() {
    // 비-@Transactional 이라 IntegrationTestBase 의 @BeforeTransaction ambient GUC 훅이 발동하지 않는다 —
    // wiki_space/wiki_page/file 은 RLS FORCE 라 GUC 없이 쓰면 실패하므로 직접 세팅한다.
    TenantContext.set(1L);
    try {
      long ownerId = createUser("own");
      long spaceId = spaceService.createTeamSpace(ownerId, "회수 커밋 테스트 공간").id();
      seededSpaceId = spaceId;
      long parentId =
          pageService.create(ownerId, spaceId, new CreatePageRequest(null, "부모 페이지")).id();
      long childId =
          pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, "자식 페이지")).id();
      // 깊이 2(손자) — 재귀 CTE 재귀항이 실제로 한 단계 더 도는지, "모든 후손" 주장이 자식 한 단계에서
      // 우연히 성립한 게 아닌지 함께 고정한다.
      long grandchildId =
          pageService.create(ownerId, spaceId, new CreatePageRequest(childId, "손자 페이지")).id();
      // 형제(부모의 형제, 즉 루트 직속의 다른 페이지) — 부모의 후손이 아니므로 회수 대상이 아니다.
      // 재귀 CTE 의 tree JOIN 이 부주의하게 넓어지면(예: 같은 스페이스 전체) 이 페이지의 첨부까지
      // 조용히 삭제되는 과다삭제가 생기는데, "지워야 할 것이 지워졌나" 만 보는 단언으로는 못 잡는다.
      long siblingId =
          pageService.create(ownerId, spaceId, new CreatePageRequest(null, "형제 페이지")).id();

      var parentFile = new MockMultipartFile("file", "parent.png", "image/png", png());
      var childFile = new MockMultipartFile("file", "child.png", "image/png", png());
      var grandchildFile = new MockMultipartFile("file", "grandchild.png", "image/png", png());
      var siblingFile = new MockMultipartFile("file", "sibling.png", "image/png", png());
      WikiAttachmentResponse parentRes = attachmentService.upload(ownerId, parentId, parentFile);
      WikiAttachmentResponse childRes = attachmentService.upload(ownerId, childId, childFile);
      WikiAttachmentResponse grandchildRes =
          attachmentService.upload(ownerId, grandchildId, grandchildFile);
      WikiAttachmentResponse siblingRes = attachmentService.upload(ownerId, siblingId, siblingFile);
      seededFileIds.add(parentRes.fileId());
      seededFileIds.add(childRes.fileId());
      seededFileIds.add(grandchildRes.fileId());
      seededFileIds.add(siblingRes.fileId());

      // 승격(expires_at IS NULL)된 첨부도 회수 대상임을 확인 — 본문에 URL 을 넣어 저장한 것처럼
      // promoteReferenced 를 직접 호출해 네 파일 모두 영구화한다(형제도 포함 — "승격됐다고 무조건 지워지지
      // 않는다"를 함께 고정).
      attachmentService.promoteReferenced(
          parentId, WikiAttachmentResponse.urlOf(parentId, parentRes.fileId()));
      attachmentService.promoteReferenced(
          childId, WikiAttachmentResponse.urlOf(childId, childRes.fileId()));
      attachmentService.promoteReferenced(
          grandchildId, WikiAttachmentResponse.urlOf(grandchildId, grandchildRes.fileId()));
      attachmentService.promoteReferenced(
          siblingId, WikiAttachmentResponse.urlOf(siblingId, siblingRes.fileId()));

      // promoteReferenced 가 실제로 승격했는지(=no-op 이 아닌지)를 삭제 직전에 직접 단언 — 이게 없으면
      // URL 포맷이 어긋나 promote 가 조용히 스킵돼도 아래 삭제 후 단언만으로는 초록이 나올 수 있다.
      assertThat(
              dsl.selectCount()
                  .from(FILE)
                  .where(
                      FILE.ID.in(
                          parentRes.fileId(),
                          childRes.fileId(),
                          grandchildRes.fileId(),
                          siblingRes.fileId()))
                  .and(FILE.EXPIRES_AT.isNull())
                  .fetchOne(0, int.class))
          .as("삭제 전 네 파일 모두 승격(expires_at IS NULL)돼 있어야 함")
          .isEqualTo(4);

      Path parentPath = attachmentService.download(ownerId, parentId, parentRes.fileId()).path();
      Path childPath = attachmentService.download(ownerId, childId, childRes.fileId()).path();
      Path grandchildPath =
          attachmentService.download(ownerId, grandchildId, grandchildRes.fileId()).path();
      Path siblingPath = attachmentService.download(ownerId, siblingId, siblingRes.fileId()).path();
      assertThat(Files.exists(parentPath)).as("업로드 직후 부모 디스크 파일 존재").isTrue();
      assertThat(Files.exists(childPath)).as("업로드 직후 자식 디스크 파일 존재").isTrue();
      assertThat(Files.exists(grandchildPath)).as("업로드 직후 손자 디스크 파일 존재").isTrue();
      assertThat(Files.exists(siblingPath)).as("업로드 직후 형제 디스크 파일 존재").isTrue();

      pageService.delete(ownerId, parentId);
      // delete() 는 자체 @Transactional 메서드라 리턴 시점에 커밋 완료 — afterCommit 도 이미 발화했어야 한다.

      assertThat(
              dsl.selectCount()
                  .from(FILE)
                  .where(FILE.ID.in(parentRes.fileId(), childRes.fileId(), grandchildRes.fileId()))
                  .fetchOne(0, int.class))
          .as("부모+자식+손자 file 행 모두 삭제되어야 함")
          .isZero();
      assertThat(Files.exists(parentPath)).as("부모 디스크 파일이 사라져야 함(afterCommit unlink)").isFalse();
      assertThat(Files.exists(childPath)).as("자식 디스크 파일도 사라져야 함(afterCommit unlink)").isFalse();
      assertThat(Files.exists(grandchildPath))
          .as("손자 디스크 파일도 사라져야 함(afterCommit unlink)")
          .isFalse();

      // 형제는 부모의 후손이 아니므로 file 행과 디스크 blob 둘 다 생존해야 한다 — 과다삭제(재귀 CTE 의
      // tree JOIN 이 부주의하게 넓어지는 회귀)를 잡는 유일한 단언.
      assertThat(
              dsl.selectCount()
                  .from(FILE)
                  .where(FILE.ID.eq(siblingRes.fileId()))
                  .fetchOne(0, int.class))
          .as("형제 file 행은 살아있어야 함(과다삭제 방지)")
          .isEqualTo(1);
      assertThat(Files.exists(siblingPath)).as("형제 디스크 파일도 살아있어야 함(과다삭제 방지)").isTrue();

      // file 행이 실제로 지워졌음을 위에서 이미 확인했으므로 @AfterEach 백스톱 대상에서 제거 — 단언이
      // 먼저 실행돼야 회귀(예: file 행이 안 지워짐) 시 테스트가 실패하면서 정리도 함께 누락되지 않는다.
      // 형제 파일은 살아있으므로 백스톱 대상으로 남겨둔다(@AfterEach 가 정리).
      seededFileIds.remove(Long.valueOf(parentRes.fileId()));
      seededFileIds.remove(Long.valueOf(childRes.fileId()));
      seededFileIds.remove(Long.valueOf(grandchildRes.fileId()));
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void reclaimPageTree_트랜잭션이_롤백되면_file_행과_디스크_바이너리가_모두_생존한다() {
    // reclaimPageTree() 의 Javadoc 이 내세우는 유일한 존재 이유(afterCommit 으로 unlink 를 미루는 이유)는
    // "롤백되면 file 행이 되살아나야 하는데 blob 을 먼저 지워버리면 안 된다"이다. 지금까지의 테스트는 해피패스
    // (커밋)만 봤으므로 이 불변식은 전혀 커버되지 않았다 — deleteBinary 를 동기화 밖에서 즉시 호출하도록
    // 바꿔도 커밋 경로 테스트는 그대로 초록이다. 이 테스트는 그 갭을 직접 메운다.
    TenantContext.set(1L);
    try {
      long ownerId = createUser("rb");
      long spaceId = spaceService.createTeamSpace(ownerId, "롤백 테스트 공간").id();
      seededSpaceId = spaceId;
      long pageId =
          pageService.create(ownerId, spaceId, new CreatePageRequest(null, "롤백 페이지")).id();

      var mf = new MockMultipartFile("file", "rollback.png", "image/png", png());
      WikiAttachmentResponse res = attachmentService.upload(ownerId, pageId, mf);
      seededFileIds.add(res.fileId());
      attachmentService.promoteReferenced(
          pageId, WikiAttachmentResponse.urlOf(pageId, res.fileId()));

      Path path = attachmentService.download(ownerId, pageId, res.fileId()).path();
      assertThat(Files.exists(path)).as("업로드 직후 디스크 파일 존재").isTrue();

      // reclaimPageTree() 자체는 @Transactional(REQUIRED) 이라 바깥 트랜잭션에 합류한다 — 바깥이
      // setRollbackOnly() 로 롤백되면 reclaimPageTree() 안의 DELETE 도 함께 롤백되고, afterCommit 도
      // 발화하지 않아야 한다.
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                attachmentService.reclaimPageTree(pageId);
                status.setRollbackOnly();
                return null;
              });

      assertThat(
              dsl.selectCount().from(FILE).where(FILE.ID.eq(res.fileId())).fetchOne(0, int.class))
          .as("롤백됐으므로 file 행이 살아있어야 함")
          .isEqualTo(1);
      assertThat(Files.exists(path)).as("롤백됐으므로 디스크 바이너리도 살아있어야 함(즉시 unlink 되면 안 됨)").isTrue();
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void 첨부_없는_페이지_삭제는_예외_없이_통과한다() {
    TenantContext.set(1L);
    try {
      long ownerId = createUser("own2");
      long spaceId = spaceService.createTeamSpace(ownerId, "빈 페이지 삭제 테스트 공간").id();
      seededSpaceId = spaceId;
      long pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "빈 페이지")).id();

      pageService.delete(ownerId, pageId);
      // 예외 없이 도달하면 통과.
    } finally {
      TenantContext.clear();
    }
  }
}

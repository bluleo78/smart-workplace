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
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

/**
 * WikiAttachmentService.delete() 의 afterCommit unlink 를 실제 커밋으로 검증하는 전용 테스트.
 *
 * <p>비-@Transactional (WikiAttachmentIntegrationTest 와 다름): {@code
 * TransactionSynchronization.afterCommit} 은 트랜잭션이 실제로 커밋될 때만 발화한다. 롤백되는 테스트 트랜잭션 안에서는 절대 발화하지 않으므로,
 * {@code afterCommit()} 을 {@code afterCompletion()} 으로 잘못 쓰거나 등록만 하고 실행을 빼먹어도 롤백 기반 테스트는 통과해버린다(리뷰
 * 지적). 이 클래스는 MailAttachmentBlobGcIntegrationTest 와 동일한 관례 — 자기 자신이 심은 id 를 {@code @AfterEach} 에서
 * 직접 정리해 공유 테스트 DB 를 오염시키지 않는다.
 */
class WikiAttachmentDeleteCommitTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;

  /**
   * @AfterEach 에서 정리할 유저 id — space/page/attachment 매핑은 wiki_space 삭제 시 CASCADE 로 함께 정리된다.
   */
  private final List<Long> seededUserIds = new ArrayList<>();

  private long seededSpaceId = -1;

  /**
   * 업로드된 file id. V126 FK 는 {@code wiki_page_attachment.file_id REFERENCES file(id) ON DELETE
   * CASCADE} — 캐스케이드는 file→매핑 방향이지 매핑→file 방향이 아니다. 그래서 wiki_space 를 지워도 wiki_page_attachment 매핑만
   * CASCADE 로 사라지고 file 행 자체는 남는다. 해피패스에서는 attachmentService.delete() 가 file 행까지 지우지만, upload 와
   * delete 사이에서 테스트 바디가 실패하면(바로 이 테스트가 뭔가 깨졌다고 알려주는 그 순간) 이 비-@Transactional 테스트는 실제로 커밋하므로 file 행이
   * 공유 테스트 DB 에 영구히 남는다(리뷰 지적) — -1 센티널로 미할당 구간을 가드.
   */
  private long seededFileId = -1;

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          // file 행 정리 — 해피패스(delete() 성공)면 이미 없으므로 no-op, 실패 종료 시에만 실제로 지운다.
          if (seededFileId != -1) {
            dsl.deleteFrom(FILE).where(FILE.ID.eq(seededFileId)).execute();
          }
          // wiki_space 삭제 → wiki_space_member/wiki_page(→wiki_page_attachment 매핑) CASCADE.
          if (seededSpaceId != -1) {
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(seededSpaceId)).execute();
          }
          if (!seededUserIds.isEmpty()) {
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
          }
        });
    seededUserIds.clear();
    seededSpaceId = -1;
    seededFileId = -1;
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

  @Test
  void 삭제_커밋_후_디스크_바이너리가_실제로_사라진다() {
    // 테스트가 비-@Transactional 이라 IntegrationTestBase 의 @BeforeTransaction 훅(ambient GUC 주입)이
    // 발동하지 않는다 — MailAttachmentBlobGcIntegrationTest 와 동일하게 직접 세팅한다. wiki_space/wiki_page/file
    // 등은 RLS FORCE 라 GUC 없이 쓰면 실패한다.
    TenantContext.set(1L);
    try {
      long ownerId = createUser("own");
      long spaceId = spaceService.createTeamSpace(ownerId, "커밋 삭제 테스트 공간").id();
      seededSpaceId = spaceId;
      long pageId =
          pageService.create(ownerId, spaceId, new CreatePageRequest(null, "삭제 커밋 페이지")).id();

      byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0};
      var mf = new MockMultipartFile("file", "a.png", "image/png", png);
      WikiAttachmentResponse res = attachmentService.upload(ownerId, pageId, mf);
      seededFileId = res.fileId(); // upload~delete 사이 실패 시 @AfterEach 백스톱용

      // 업로드가 이미 커밋된 상태(서비스 메서드가 @Transactional 이고 테스트가 비-@Transactional)이므로
      // 디스크에 실제 파일이 있는지 여기서 먼저 확인해둔다.
      var stored = attachmentService.download(ownerId, pageId, res.fileId());
      assertThat(Files.exists(stored.path())).as("업로드 직후 디스크에 파일이 있어야 함").isTrue();

      attachmentService.delete(ownerId, pageId, res.fileId());
      // delete() 는 자체 @Transactional 메서드라 리턴 시점에 이미 커밋 완료 — afterCommit 도 이미 발화했어야 한다.
      // file 행도 이미 delete() 안에서 지워졌으므로 @AfterEach 백스톱 대상에서 제거(중복 delete 는 어차피 no-op 이라 안전하지만
      // 의도를 명확히 한다).
      seededFileId = -1;

      assertThat(Files.exists(stored.path()))
          .as(
              "커밋 후 디스크 바이너리가 실제로 사라져야 한다(afterCommit unlink) — afterCompletion 오기재나 등록만 하고 미실행이면 이 단언이"
                  + " 깨진다")
          .isFalse();
    } finally {
      TenantContext.clear();
    }
  }
}

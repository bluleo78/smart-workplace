package com.workplace.wiki;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;
import static com.workplace.jooq.tables.File.FILE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 노트 팀 스페이스 삭제(WP-580) — DELETE /api/v1/wiki/spaces/{id} 가 스페이스·페이지와 함께 첨부 파일(행·디스크)과 공용 AI 메모리를
 * 정리하고, 다른 스페이스는 건드리지 않는지 검증한다.
 *
 * <p>비-@Transactional: 첨부 바이너리 삭제는 afterCommit 에서만 일어나므로 실제 커밋이 있어야
 * 검증된다(WikiAttachmentPageDeleteCommitTest 와 같은 이유). 정리는 자기-id {@code @AfterEach} 로 직접 한다.
 */
class WikiSpaceDeleteCommitTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MockMvc mockMvc;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;
  @Autowired SharedAiMemoryRepository sharedMemory;

  private final List<Long> seededUserIds = new ArrayList<>();
  private final List<Long> seededSpaceIds = new ArrayList<>();
  private final List<Long> seededFileIds = new ArrayList<>();

  @BeforeEach
  void setTenant() {
    // 비-@Transactional 이라 ambient GUC 훅이 돌지 않는다 — RLS FORCE 표에 쓰려면 직접 세팅한다.
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (!seededFileIds.isEmpty()) {
            dsl.deleteFrom(FILE).where(FILE.ID.in(seededFileIds)).execute();
          }
          if (!seededSpaceIds.isEmpty()) {
            dsl.deleteFrom(SHARED_AI_MEMORY)
                .where(SHARED_AI_MEMORY.SPACE_TYPE.eq("WIKI_SPACE"))
                .and(SHARED_AI_MEMORY.SPACE_ID.in(seededSpaceIds))
                .execute();
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.in(seededSpaceIds)).execute();
          }
          if (!seededUserIds.isEmpty()) {
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.in(seededUserIds)).execute();
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
          }
        });
    seededUserIds.clear();
    seededSpaceIds.clear();
    seededFileIds.clear();
    TenantContext.clear();
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
    // 테넌트#1 ACTIVE 멤버십 — 멤버 추가(MembershipGuard)와 토큰 인증이 테넌트 소속을 본다(user 삭제 때 CASCADE).
    withMembership(id);
    seededUserIds.add(id);
    return id;
  }

  private long createSpace(long ownerId, String name) {
    long id = spaceService.createTeamSpace(ownerId, name + " " + UUID.randomUUID()).id();
    seededSpaceIds.add(id);
    return id;
  }

  /** 페이지에 이미지를 올리고 본문 참조로 승격(영구화)한 뒤 디스크 경로를 돌려준다. */
  private Path attach(long ownerId, long pageId, String name) {
    byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0};
    WikiAttachmentResponse res =
        attachmentService.upload(
            ownerId, pageId, new MockMultipartFile("file", name, "image/png", png));
    seededFileIds.add(res.fileId());
    attachmentService.syncReferences(pageId, WikiAttachmentResponse.urlOf(pageId, res.fileId()));
    return attachmentService.download(ownerId, pageId, res.fileId()).path();
  }

  private String bearer(long userId) {
    return "Bearer " + jwt.generateAccessToken(userId, "u", 1L);
  }

  @Test
  void OWNER_가_팀_스페이스를_지우면_페이지_첨부_공용메모리가_함께_사라지고_다른_스페이스는_남는다() throws Exception {
    long owner = createUser("own");
    long spaceId = createSpace(owner, "지울 스페이스");
    long otherSpaceId = createSpace(owner, "남길 스페이스");

    // 루트 둘 + 자식 하나 — 루트마다 서브트리 첨부를 회수하는지(두 번째 루트·자식까지) 함께 본다.
    long root = pageService.create(owner, spaceId, new CreatePageRequest(null, "루트")).id();
    long child = pageService.create(owner, spaceId, new CreatePageRequest(root, "자식")).id();
    long root2 = pageService.create(owner, spaceId, new CreatePageRequest(null, "루트2")).id();
    long otherPage =
        pageService.create(owner, otherSpaceId, new CreatePageRequest(null, "다른 공간")).id();
    Path childBlob = attach(owner, child, "child.png");
    Path root2Blob = attach(owner, root2, "root2.png");
    Path otherBlob = attach(owner, otherPage, "other.png");

    OffsetDateTime now = OffsetDateTime.now();
    sharedMemory.insert(
        SpaceKey.of("WIKI_SPACE", spaceId), "지울 공간 메모리", "USER_ADDED", owner, owner, now);
    sharedMemory.insert(
        SpaceKey.of("WIKI_SPACE", otherSpaceId), "남길 공간 메모리", "USER_ADDED", owner, owner, now);

    mockMvc
        .perform(delete("/api/v1/wiki/spaces/" + spaceId).header("Authorization", bearer(owner)))
        .andExpect(status().isNoContent());

    // 컨트롤러 요청이 끝나면 TenantContext 가 비워진다 — 단언 조회를 위해 다시 세팅한다.
    TenantContext.set(1L);
    assertThat(dsl.fetchCount(WIKI_SPACE, WIKI_SPACE.ID.eq(spaceId))).isZero();
    assertThat(dsl.fetchCount(WIKI_SPACE_MEMBER, WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))).isZero();
    assertThat(dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.ID.in(root, child, root2))).isZero();
    assertThat(childBlob).as("자식 페이지 첨부 바이너리 회수").doesNotExist();
    assertThat(root2Blob).as("두 번째 루트 첨부 바이너리 회수").doesNotExist();
    assertThat(
            dsl.fetchCount(
                SHARED_AI_MEMORY,
                SHARED_AI_MEMORY
                    .SPACE_TYPE
                    .eq("WIKI_SPACE")
                    .and(SHARED_AI_MEMORY.SPACE_ID.eq(spaceId))))
        .as("지운 스페이스의 공용 AI 메모리")
        .isZero();

    // 다른 스페이스는 그대로 — 과다 삭제 방지.
    assertThat(dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.ID.eq(otherPage))).isEqualTo(1);
    assertThat(Files.exists(otherBlob)).as("다른 스페이스 첨부 바이너리").isTrue();
    assertThat(
            dsl.fetchCount(
                SHARED_AI_MEMORY,
                SHARED_AI_MEMORY
                    .SPACE_TYPE
                    .eq("WIKI_SPACE")
                    .and(SHARED_AI_MEMORY.SPACE_ID.eq(otherSpaceId))))
        .isEqualTo(1);
  }

  @Test
  void OWNER_가_아니면_403_멤버가_아니면_404_개인_스페이스는_거부되고_스페이스는_남는다() throws Exception {
    long owner = createUser("own");
    long editor = createUser("edt");
    long stranger = createUser("str");
    long spaceId = createSpace(owner, "권한 확인 스페이스");
    spaceService.addMember(owner, spaceId, editor, "EDITOR");
    long personalId = spaceService.ensurePersonalSpace(owner).id();
    seededSpaceIds.add(personalId);

    mockMvc
        .perform(delete("/api/v1/wiki/spaces/" + spaceId).header("Authorization", bearer(editor)))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(delete("/api/v1/wiki/spaces/" + spaceId).header("Authorization", bearer(stranger)))
        .andExpect(status().isNotFound());
    // 개인 스페이스 — 본인(OWNER)이어도 거부한다(유형 변경 불가 409, 멤버 변경 거부와 같은 응답).
    mockMvc
        .perform(delete("/api/v1/wiki/spaces/" + personalId).header("Authorization", bearer(owner)))
        .andExpect(status().isConflict());

    TenantContext.set(1L);
    assertThat(dsl.fetchCount(WIKI_SPACE, WIKI_SPACE.ID.in(spaceId, personalId))).isEqualTo(2);
  }
}

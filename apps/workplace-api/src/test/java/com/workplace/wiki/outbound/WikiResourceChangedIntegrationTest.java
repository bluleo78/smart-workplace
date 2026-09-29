package com.workplace.wiki.outbound;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;

import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import com.workplace.support.ResourceChangedCapture.Captured;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-64 통합 — 위키 스페이스 멤버·첨부 변경 → AFTER_COMMIT resource.changed 수신자 검증. AFTER_COMMIT 발화를 위해
 * 클래스에 @Transactional 을 붙이지 않는다.
 */
@DisplayName("위키 변경 → resource.changed fan-out 통합")
class WikiResourceChangedIntegrationTest extends IntegrationTestBase {

  private static final byte[] PNG_MAGIC = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient;

  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long member;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = createHuman();
    member = createHuman();
    spaceId = spaceService.createTeamSpace(owner, "rc-공간-" + UUID.randomUUID()).id();
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          var pageIds =
              dsl.select(WIKI_PAGE.ID).from(WIKI_PAGE).where(WIKI_PAGE.SPACE_ID.eq(spaceId));
          dsl.deleteFrom(FILE)
              .where(
                  FILE.ID.in(
                      dsl.select(WIKI_PAGE_ATTACHMENT.FILE_ID)
                          .from(WIKI_PAGE_ATTACHMENT)
                          .where(WIKI_PAGE_ATTACHMENT.PAGE_ID.in(pageIds))))
              .execute();
          dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.SPACE_ID.eq(spaceId)).execute();
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(spaceId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
    TenantContext.clear();
  }

  /** resource/op 조합의 resource.changed 를 캡처해 (수신자, payload) 를 돌려준다 — 공용 헬퍼 위임. */
  private Captured capture(String resource, String op) {
    return ResourceChangedCapture.capture(registry, resource, op);
  }

  @Test
  @DisplayName("멤버 제거는 제거된 사용자와 남은 멤버 모두에게")
  void wikiRemoveMember_reachesRemovedUser() {
    spaceService.addMember(owner, spaceId, member, "EDITOR");
    clearInvocations(registry);
    spaceService.removeMember(owner, spaceId, member);
    var c = capture("wiki-space", "updated");
    assertThat(c.recipients()).contains(owner, member);
    assertThat(c.payload().get("spaceId")).isEqualTo(spaceId);
  }

  @Test
  @DisplayName("첨부 업로드는 스페이스 멤버 전원에게, spaceId·pageId 포함")
  void wikiAttachmentUpload_reachesSpaceMembers() {
    spaceService.addMember(owner, spaceId, member, "EDITOR");
    long pageId = pageService.create(owner, spaceId, new CreatePageRequest(null, "rc 페이지")).id();
    byte[] data = PNG_MAGIC.clone();
    clearInvocations(registry);
    attachmentService.upload(
        owner, pageId, new MockMultipartFile("file", "a.png", "image/png", data));
    var c = capture("wiki-attachment", "created");
    assertThat(c.recipients()).contains(owner, member);
    assertThat(c.payload().get("spaceId")).isEqualTo(spaceId);
    assertThat(c.payload().get("pageId")).isEqualTo(pageId);
  }

  /** 테넌트#1 ACTIVE 멤버 HUMAN 1명 — 공용 픽스처로 만들고 정리 목록에 넣는다. */
  private long createHuman() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(id);
    return id;
  }
}

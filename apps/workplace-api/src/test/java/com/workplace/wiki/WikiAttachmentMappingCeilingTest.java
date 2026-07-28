package com.workplace.wiki;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.exception.WikiAttachmentLimitException;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * #759 (A) 페이지당 매핑 총개수 하드 실링 전용 테스트.
 *
 * <p>운영 기본값 500 을 그대로 두면 테스트가 무거우므로 2 로 낮춘다. 해소 가능한 상한(max-per-page)은 실링보다 높게 둬서, 여기서 나는 409 가 반드시
 * 실링 때문임을 보장한다 — 둘을 같은 값으로 두면 어느 상한이 걸렸는지 구분되지 않아 실링을 지워도 초록이 된다.
 */
@Transactional
@TestPropertySource(
    properties = {
      "workplace.storage.wiki.max-image-size-bytes=200",
      "workplace.storage.wiki.max-per-page=50",
      "workplace.storage.wiki.max-mappings-per-page=2"
    })
class WikiAttachmentMappingCeilingTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;

  @Test
  void 참조를_지워_상한을_풀어도_매핑_실링에는_걸린다() {
    long ownerId = createUser("ceil");
    long spaceId = spaceService.createTeamSpace(ownerId, "실링 테스트 공간").id();
    long pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "페이지")).id();

    // 실링(2)까지 채운다 — 본문에 넣고 저장했다가 지워 "해소 가능한 상한" 은 계속 0 으로 유지한다.
    // 즉 #757 이 만든 해소 경로가 열려 있음에도 매핑이 쌓여 결국 막히는지를 본다.
    for (int i = 0; i < 2; i++) {
      var res = attachmentService.upload(ownerId, pageId, png("a" + i + ".png"));
      attachmentService.syncReferences(
          pageId, "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")");
      attachmentService.syncReferences(pageId, "참조를 지운 본문");
    }

    // 해소 가능한 상한과 실링은 둘 다 같은 예외·409 라, 사유까지 고정하지 않으면 어느 쪽이 걸렸는지
    // 구분되지 않는다(사용자에게 통하지 않는 조치를 안내하게 되는 지점).
    assertThatThrownBy(() -> attachmentService.upload(ownerId, pageId, png("over.png")))
        .isInstanceOf(WikiAttachmentLimitException.class)
        .hasMessageContaining("누적 한도");
  }

  @Test
  void 실링_아래에서는_업로드가_통과한다() {
    // 거부 단언만 있으면 "실링이 항상 던진다" 는 변이가 통과한다.
    long ownerId = createUser("ceil");
    long spaceId = spaceService.createTeamSpace(ownerId, "실링 여유 공간").id();
    long pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "페이지")).id();

    var res = attachmentService.upload(ownerId, pageId, png("first.png"));

    assertThat(res.fileId()).isPositive();
  }

  private MockMultipartFile png(String name) {
    return new MockMultipartFile(
        "file",
        name,
        "image/png",
        new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0});
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
    return id;
  }
}

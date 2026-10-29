package com.workplace.home.controller;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 채팅 앱 링크 카드 API(WP-896) — 보는 사람 권한으로 이슈·노트·파일 카드 칸을 주고, 볼 수 없거나 없는 대상은 정보 없이 오류로 돌린다. 실제
 * API(MockMvc)로 부른다. {@code @Transactional}: 끝나면 롤백된다.
 */
@Transactional
class AppLinkControllerTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired WikiSpaceService wikiSpaceService;
  @Autowired WikiPageService pageService;
  @Autowired DriveSpaceService driveSpaceService;
  @Autowired DriveFileService driveFileService;

  private long ownerId; // 프로젝트·스페이스 주인 — 다 볼 수 있다
  private long strangerId; // 어디에도 멤버가 아닌 같은 워크스페이스 사람
  private long rolelessId; // 프로젝트 멤버지만 전역 역할이 없어 project:read 가 없는 사람(WP-1165)
  private String projectKey;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    strangerId = withMembership(TestFixtures.createHuman(dsl));
    rolelessId = withMembership(TestFixtures.createHuman(dsl));
    // 이슈 카드는 이슈 상세처럼 project:read 를 요구한다 — 실제 사람처럼 USER 역할을 준다.
    TestFixtures.grantRole(dsl, ownerId, "USER");
    TestFixtures.grantRole(dsl, strangerId, "USER");
    projectKey = "AL" + UUID.randomUUID().toString().replace("-", "").substring(0, 4).toUpperCase();
    var p =
        projectService.create(ownerId, new CreateProjectRequest(projectKey, "앱링크", "x", "TEAM"));
    IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "카드로 볼 이슈", null, "MID", null, ownerId);
    TenantContext.set(1L);
    projectService.addMember(ownerId, projectKey, new AddMemberRequest(rolelessId, "MEMBER"));
    TenantContext.set(1L);
  }

  private ResultActions call(String path, long userId) throws Exception {
    TenantContext.set(1L);
    ResultActions r =
        mvc.perform(
            get(path)
                .header(
                    "Authorization",
                    "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L)));
    TenantContext.set(1L);
    return r;
  }

  @Test
  void 설정은_공개_웹_주소의_호스트를_로그인한_사용자에게만_준다() throws Exception {
    // 테스트 프로필의 공개 웹 주소는 http://localhost:6173 — 포트를 뺀 소문자 호스트(WP-1165).
    call("/api/v1/app-links/config", rolelessId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.appHost").value("localhost"));
    TenantContext.set(1L);
    mvc.perform(get("/api/v1/app-links/config")).andExpect(status().isUnauthorized());
    TenantContext.set(1L);
  }

  @Test
  void 이슈_링크는_키_제목_상태_담당자를_준다() throws Exception {
    call("/api/v1/app-links/issues/" + projectKey + "/1", ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("ISSUE"))
        .andExpect(jsonPath("$.issueKey").value(projectKey + "-1"))
        .andExpect(jsonPath("$.title").value("카드로 볼 이슈"))
        .andExpect(jsonPath("$.statusCategory").value("TODO"))
        .andExpect(jsonPath("$.statusName").isNotEmpty())
        .andExpect(jsonPath("$.assignees", hasSize(0)))
        .andExpect(jsonPath("$.priority").value("MID"))
        // 다른 종류의 칸은 싣지 않는다.
        .andExpect(jsonPath("$.spaceName").doesNotExist());
  }

  @Test
  void 볼_수_없는_프로젝트의_이슈와_없는_이슈는_정보_없이_404() throws Exception {
    call("/api/v1/app-links/issues/" + projectKey + "/1", strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist());
    call("/api/v1/app-links/issues/" + projectKey + "/999", ownerId)
        .andExpect(status().isNotFound());
  }

  @Test
  void 이슈_카드는_이슈_상세처럼_project_read_권한이_있어야_한다() throws Exception {
    // 프로젝트 멤버여도 전역 권한 project:read 가 없으면 이슈 상세와 같이 403 — 카드로 우회해 읽지 못한다(WP-1165).
    call("/api/v1/projects/" + projectKey + "/issues/1", rolelessId)
        .andExpect(status().isForbidden());
    call("/api/v1/app-links/issues/" + projectKey + "/1", rolelessId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.title").doesNotExist());
  }

  @Test
  void 이슈_번호가_int_범위를_넘으면_400_이고_정보는_없다() throws Exception {
    // 웹·서버 판정은 9자리까지만 앱 카드로 본다 — 그 밖의 번호를 직접 불러도 정보 없이 거절된다.
    call("/api/v1/app-links/issues/" + projectKey + "/99999999999", ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.title").doesNotExist());
  }

  @Test
  void 노트_링크는_제목과_스페이스_이름을_주고_비멤버는_받지_못한다() throws Exception {
    String spaceName = "앱링크노트-" + UUID.randomUUID();
    long spaceId = wikiSpaceService.createTeamSpace(ownerId, spaceName).id();
    TenantContext.set(1L);
    long pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "회의록")).id();

    call("/api/v1/app-links/pages/" + pageId, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("PAGE"))
        .andExpect(jsonPath("$.title").value("회의록"))
        .andExpect(jsonPath("$.spaceName").value(spaceName));
    call("/api/v1/app-links/pages/999999999", ownerId).andExpect(status().isNotFound());

    // 볼 수 없는 노트도 없는 노트와 같은 404·같은 문구 — 있는지조차 알 수 없다.
    String missing = errorMessage(call("/api/v1/app-links/pages/999999999", strangerId));
    call("/api/v1/app-links/pages/" + pageId, strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
  }

  @Test
  void 파일_링크는_이름을_주고_비멤버는_받지_못한다() throws Exception {
    long spaceId = driveSpaceService.createTeamSpace(ownerId, "앱링크드라이브-" + UUID.randomUUID()).id();
    TenantContext.set(1L);
    long fileId =
        driveFileService
            .upload(
                ownerId,
                spaceId,
                null,
                new MockMultipartFile("file", "견적서.pdf", "application/pdf", "pdf".getBytes()))
            .id();

    call("/api/v1/app-links/files/" + fileId, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("FILE"))
        .andExpect(jsonPath("$.title", startsWith("견적서")));

    // 비멤버가 받는 응답이 없는 파일과 같은 404·같은 문구여야 id 가 있는지 알 수 없다(WP-1165 — 전엔 「공간 없음」으로 갈렸다).
    String missing = errorMessage(call("/api/v1/app-links/files/999999999", strangerId));
    call("/api/v1/app-links/files/" + fileId, strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
  }

  /** 404 응답의 오류 문구 — 볼 수 없는 대상과 없는 대상의 응답을 견준다. */
  private static String errorMessage(ResultActions r) throws Exception {
    r.andExpect(status().isNotFound());
    return JsonPath.read(
        r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8), "$.message");
  }
}

package com.workplace.global;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.AppWebLinks;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 도구가 읽는 응답에 웹 화면 주소(url)가 실리는지(WP-1523) — AI 가 본문에 주소를 지어내지 않고 이 값을 쓴다.
 *
 * <p>주소 모양은 웹 라우트(apps/workplace-web appUrl.ts·appLinks.ts)와 같아야 한다: 이슈 /projects/{KEY}/issues/{n},
 * 노트 /wiki/spaces/{spaceId}/pages/{id}, 드라이브 파일
 * /drive/spaces/{spaceId}?folderId={folderId}&preview={id}(웹 driveFilePath — 최상위면 folderId 없음), 일정
 * /calendar?eventId={id}. 기준 주소는 workplace.public-base-url 그대로(끝 슬래시 없이) 앞에 붙는다.
 */
@Transactional
class WebUrlInResponsesTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired WikiSpaceService wikiSpaceService;
  @Autowired DriveSpaceService driveSpaceService;

  /** 테스트 프로필의 공개 웹 주소(끝 슬래시 제거) — 기대값을 하드코딩하지 않고 설정에서 읽는다. */
  @Value("${workplace.public-base-url}")
  String publicBaseUrl;

  private String base;
  private long userId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    base = publicBaseUrl.replaceAll("/+$", "");
    userId = createUser();
  }

  /** 이슈 생성 응답과 상세 응답에 /projects/{KEY}/issues/{n} 주소가 실린다. */
  @Test
  void issue_create_and_detail_carry_url() throws Exception {
    String key = "WU" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 6);
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));

    JsonNode created =
        json(call(postJson("/api/v1/projects/" + key + "/issues", Map.of("title", "t"))));
    int number = created.get("number").asInt();
    // 기존 필드는 그대로 펼쳐져 있다(@JsonUnwrapped) — 웹이 읽는 모양이 바뀌지 않는다.
    assertThat(created.get("title").asText()).isEqualTo("t");
    assertThat(created.get("url").asText())
        .isEqualTo(base + "/projects/" + key + "/issues/" + number);

    JsonNode detail = json(call(get("/api/v1/projects/" + key + "/issues/" + number)));
    assertThat(detail.get("summary").get("number").asInt()).isEqualTo(number);
    assertThat(detail.get("url").asText())
        .isEqualTo(base + "/projects/" + key + "/issues/" + number);

    // 수정(PATCH) 응답에도 실린다 — update_issue 가 내용 수정 응답에서 옮긴다.
    JsonNode updated =
        json(
            call(
                patch("/api/v1/projects/" + key + "/issues/" + number)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(om.writeValueAsString(Map.of("title", "t2")))));
    assertThat(updated.get("summary").get("title").asText()).isEqualTo("t2");
    assertThat(updated.get("url").asText())
        .isEqualTo(base + "/projects/" + key + "/issues/" + number);
  }

  /**
   * 노트 만들기·읽기·저장 응답에 /wiki/spaces/{spaceId}/pages/{id} 주소가 실린다(create_wiki_page 는 만든 뒤 PUT 으로 본문을
   * 넣는다).
   */
  @Test
  void wiki_page_create_get_save_carry_url() throws Exception {
    long spaceId = wikiSpaceService.createTeamSpace(userId, "주소-" + UUID.randomUUID()).id();
    Map<String, Object> body = new HashMap<>();
    body.put("parentId", null);
    body.put("title", "회의록");
    JsonNode created = json(call(postJson("/api/v1/wiki/spaces/" + spaceId + "/pages", body)));
    long pageId = created.get("id").asLong();
    String expected = base + "/wiki/spaces/" + spaceId + "/pages/" + pageId;
    assertThat(created.get("url").asText()).isEqualTo(expected);

    JsonNode read = json(call(get("/api/v1/wiki/pages/" + pageId)));
    assertThat(read.get("url").asText()).isEqualTo(expected);

    Map<String, Object> save = new HashMap<>();
    save.put("version", read.get("version").asInt());
    save.put("body", "본문");
    save.put("snapshot", false);
    JsonNode saved =
        json(
            call(
                put("/api/v1/wiki/pages/" + pageId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(om.writeValueAsString(save))));
    assertThat(saved.get("url").asText()).isEqualTo(expected);
  }

  /**
   * 드라이브 텍스트 파일 만들기·고치기 응답(파일 행)에 웹 driveFilePath 와 같은 주소가 실린다 — 최상위 파일은 ?preview={id}, 하위 폴더 파일은
   * ?folderId={folderId}&preview={id}(드라이브 화면은 지금 폴더 목록에서만 미리볼 파일을 찾는다).
   */
  @Test
  void drive_file_rows_carry_url() throws Exception {
    long spaceId = driveSpaceService.createTeamSpace(userId, "주소-" + UUID.randomUUID()).id();
    JsonNode created =
        json(
            call(
                postJson(
                    "/api/v1/drive/spaces/" + spaceId + "/files/text",
                    Map.of("name", "memo.md", "content", "hello"))));
    long driveFileId = created.get("id").asLong();
    String expected = base + "/drive/spaces/" + spaceId + "?preview=" + driveFileId;
    assertThat(created.get("url").asText()).isEqualTo(expected);

    JsonNode updated =
        json(
            call(
                postJson(
                    "/api/v1/drive/files/" + driveFileId + "/text", Map.of("content", "hello 2"))));
    assertThat(updated.get("url").asText()).isEqualTo(expected);

    long folderId =
        json(call(postJson("/api/v1/drive/spaces/" + spaceId + "/folders", Map.of("name", "회의"))))
            .get("id")
            .asLong();
    Map<String, Object> inFolder = new HashMap<>();
    inFolder.put("folderId", folderId);
    inFolder.put("name", "sub.md");
    inFolder.put("content", "x");
    JsonNode sub =
        json(call(postJson("/api/v1/drive/spaces/" + spaceId + "/files/text", inFolder)));
    assertThat(sub.get("url").asText())
        .isEqualTo(
            base
                + "/drive/spaces/"
                + spaceId
                + "?folderId="
                + folderId
                + "&preview="
                + sub.get("id").asLong());
  }

  /** 일정 만들기·읽기 응답에 /calendar?eventId={id} 주소가 실린다. */
  @Test
  void calendar_event_create_and_get_carry_url() throws Exception {
    JsonNode created =
        json(
            call(
                postJson(
                    "/api/v1/calendar/events",
                    Map.of(
                        "title", "회의",
                        "startsAt", "2026-11-20T10:00:00+09:00",
                        "endsAt", "2026-11-20T11:00:00+09:00"))));
    long eventId = created.get("id").asLong();
    String expected = base + "/calendar?eventId=" + eventId;
    assertThat(created.get("url").asText()).isEqualTo(expected);

    JsonNode read = json(call(get("/api/v1/calendar/events/" + eventId)));
    assertThat(read.get("url").asText()).isEqualTo(expected);

    // 수정(PATCH) 응답에도 실린다.
    JsonNode updated =
        json(
            call(
                patch("/api/v1/calendar/events/" + eventId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        om.writeValueAsString(
                            Map.of(
                                "title", "회의2",
                                "startsAt", "2026-11-20T10:00:00+09:00",
                                "endsAt", "2026-11-20T11:00:00+09:00")))));
    assertThat(updated.get("title").asText()).isEqualTo("회의2");
    assertThat(updated.get("url").asText()).isEqualTo(expected);
  }

  /** 기준 주소가 비면 url 을 만들지 않는다(null) — 상대 경로를 내보내면 AI 가 호스트를 지어 붙인다. 끝 슬래시는 지운다. */
  @Test
  void links_follow_base_url_rules() {
    assertThat(new AppWebLinks("").issue("WP", 12)).isNull();
    assertThat(new AppWebLinks("  ").wikiPage(1, 2)).isNull();
    AppWebLinks links = new AppWebLinks("https://works.example.com/");
    assertThat(links.issue("WP", 12)).isEqualTo("https://works.example.com/projects/WP/issues/12");
    assertThat(links.wikiPage(3, 4)).isEqualTo("https://works.example.com/wiki/spaces/3/pages/4");
    assertThat(links.driveFile(5, null, 6))
        .isEqualTo("https://works.example.com/drive/spaces/5?preview=6");
    assertThat(links.driveFile(5, 9L, 6))
        .isEqualTo("https://works.example.com/drive/spaces/5?folderId=9&preview=6");
    assertThat(links.calendarEvent(7)).isEqualTo("https://works.example.com/calendar?eventId=7");
    assertThat(links.issue(null, 1)).isNull();
    // 상대 경로(알림·우선순위·첨부 출처 딥링크) — 옮기기 전 손으로 만들던 글자와 같다.
    assertThat(AppWebLinks.issuePath("WP", 12)).isEqualTo("/projects/WP/issues/12");
    assertThat(AppWebLinks.wikiPagePath(3, 4)).isEqualTo("/wiki/spaces/3/pages/4");
    assertThat(AppWebLinks.calendarEventPath(7)).isEqualTo("/calendar?eventId=7");
  }

  /** USER 역할의 활성 구성원 — 이슈·일정 쓰기 권한이 있다. */
  private long createUser() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "wu-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "wu")
            .set(USER.EMAIL, "wu-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    return id;
  }

  private MockHttpServletRequestBuilder postJson(String path, Map<String, ?> body)
      throws Exception {
    return post(path).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body));
  }

  /** JWT 로 부르고 2xx 를 확인한다. 요청이 테넌트 컨텍스트를 지우므로 다시 심는다. */
  private String call(MockHttpServletRequestBuilder req) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    var res = mvc.perform(req).andReturn().getResponse();
    TenantContext.set(1L);
    assertThat(res.getStatus()).as(res.getContentAsString()).isBetween(200, 299);
    return res.getContentAsString();
  }

  private JsonNode json(String s) throws Exception {
    return om.readTree(s);
  }
}

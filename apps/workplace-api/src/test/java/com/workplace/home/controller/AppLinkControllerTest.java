package com.workplace.home.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.jooq.Tables;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
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
  @Autowired DriveFolderService driveFolderService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository channelMemberRepo;
  @Autowired MessageService messageService;
  @Autowired DmService dmService;
  @Autowired CalendarEventService calendarEventService;
  @Autowired EmailMessageRepository emailMessageRepo;
  @Autowired DriveShareLinkService shareLinkService;

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

  @Test
  void 폴더_링크는_폴더_이름과_공간_이름을_주고_비멤버_없는_폴더_휴지통_폴더는_같은_404() throws Exception {
    // WP-1536 — 폴더 목록을 열 때와 같은 VIEWER 판정. 볼 수 없는 폴더도 없는 폴더와 같은 404·같은 문구여야 id 가 있는지 알 수 없다.
    String spaceName = "앱링크폴더-" + UUID.randomUUID();
    long spaceId = driveSpaceService.createTeamSpace(ownerId, spaceName).id();
    TenantContext.set(1L);
    long folderId = driveFolderService.create(ownerId, spaceId, null, "회의록").id();
    TenantContext.set(1L);
    String path = "/api/v1/app-links/folders/" + folderId + "?spaceId=" + spaceId;

    call(path, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("FOLDER"))
        .andExpect(jsonPath("$.title").value("회의록"))
        .andExpect(jsonPath("$.spaceName").value(spaceName));

    String missing =
        errorMessage(call("/api/v1/app-links/folders/999999999?spaceId=" + spaceId, ownerId));
    call(path, strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.spaceName").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));

    // 휴지통에 넣은 폴더는 주인에게도 없는 폴더와 같다.
    driveFolderService.delete(ownerId, folderId);
    TenantContext.set(1L);
    call(path, ownerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
  }

  @Test
  void 폴더_링크의_공간이_폴더의_실제_공간과_다르면_두_공간의_멤버에게도_같은_404() throws Exception {
    // WP-1536 — /drive/spaces/1?folderId=50 인데 폴더 50 이 공간 2 에 있으면 링크를 눌러도 그 폴더가 열리지 않는다. 카드도 없는 폴더로
    // 본다.
    long linkSpace =
        driveSpaceService.createTeamSpace(ownerId, "앱링크링크공간-" + UUID.randomUUID()).id();
    TenantContext.set(1L);
    long realSpace =
        driveSpaceService.createTeamSpace(ownerId, "앱링크실제공간-" + UUID.randomUUID()).id();
    TenantContext.set(1L);
    long folderId = driveFolderService.create(ownerId, realSpace, null, "다른 공간 폴더").id();
    TenantContext.set(1L);

    String missing =
        errorMessage(call("/api/v1/app-links/folders/999999999?spaceId=" + linkSpace, ownerId));
    call("/api/v1/app-links/folders/" + folderId + "?spaceId=" + linkSpace, ownerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.spaceName").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
    // 맞는 공간으로 부르면 카드가 나온다.
    call("/api/v1/app-links/folders/" + folderId + "?spaceId=" + realSpace, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("다른 공간 폴더"));
  }

  @Test
  void 드라이브_공간_링크는_공간_이름을_주고_비멤버와_없는_공간은_같은_404() throws Exception {
    // WP-1536 — 공간 첫 화면(/drive/spaces/{id}) 카드. 공간을 열 때와 같은 VIEWER 판정.
    String spaceName = "앱링크공간-" + UUID.randomUUID();
    long spaceId = driveSpaceService.createTeamSpace(ownerId, spaceName).id();
    TenantContext.set(1L);

    call("/api/v1/app-links/drive-spaces/" + spaceId, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("DRIVE_SPACE"))
        .andExpect(jsonPath("$.title").value(spaceName))
        .andExpect(jsonPath("$.spaceName").doesNotExist());

    String missing = errorMessage(call("/api/v1/app-links/drive-spaces/999999999", strangerId));
    call("/api/v1/app-links/drive-spaces/" + spaceId, strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
  }

  @Test
  void 채널_메시지_링크는_미리보기_채널_이름_보낸_사람_시각을_주고_비멤버는_받지_못한다() throws Exception {
    String channelName = "앱링크채널-" + UUID.randomUUID().toString().substring(0, 8);
    long channelId = channelRepo.insert(channelName, "PRIVATE", ownerId);
    channelMemberRepo.add(channelId, ownerId, "OWNER");
    TenantContext.set(1L);
    // 마크다운 기호·줄바꿈은 푸시 미리보기처럼 지우고 접는다.
    long msgId =
        messageService
            .create(ownerId, channelId, new CreateMessageRequest("**배포** 일정\n\n  공유합니다"))
            .id();
    TenantContext.set(1L);
    String ownerName = userName(ownerId);

    call("/api/v1/app-links/messages/" + msgId, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("MESSAGE"))
        .andExpect(jsonPath("$.title").value("배포 일정 공유합니다"))
        .andExpect(jsonPath("$.channelName").value(channelName))
        .andExpect(jsonPath("$.channelKind").value("CHANNEL"))
        .andExpect(jsonPath("$.authorName").value(ownerName))
        .andExpect(jsonPath("$.sentAt").isNotEmpty())
        // 다른 종류의 칸은 싣지 않는다.
        .andExpect(jsonPath("$.startAt").doesNotExist())
        .andExpect(jsonPath("$.issueKey").doesNotExist());

    // 비공개 채널의 비멤버 응답은 없는 메시지와 같은 404·같은 문구 — 메시지 id 가 있는지 알 수 없다.
    String missing = errorMessage(call("/api/v1/app-links/messages/999999999", strangerId));
    call("/api/v1/app-links/messages/" + msgId, strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
  }

  @Test
  void 삭제된_메시지_링크는_멤버에게도_정보_없이_404() throws Exception {
    long channelId = channelRepo.insert("앱링크삭제-" + UUID.randomUUID(), "PRIVATE", ownerId);
    channelMemberRepo.add(channelId, ownerId, "OWNER");
    TenantContext.set(1L);
    long msgId = messageService.create(ownerId, channelId, new CreateMessageRequest("지울 글")).id();
    TenantContext.set(1L);
    messageService.delete(ownerId, msgId);
    TenantContext.set(1L);

    String missing = errorMessage(call("/api/v1/app-links/messages/999999999", ownerId));
    call("/api/v1/app-links/messages/" + msgId, ownerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
  }

  @Test
  void DM_메시지_링크는_보는_사람_기준_상대_이름을_대화_이름으로_준다() throws Exception {
    long dmId = dmService.createOrGet(ownerId, List.of(strangerId)).dm().id();
    TenantContext.set(1L);
    long msgId = messageService.create(strangerId, dmId, new CreateMessageRequest("안녕하세요")).id();
    TenantContext.set(1L);

    // 주인에게는 상대(stranger)의 이름, 상대에게는 주인의 이름 — 대화 목록의 DM 표기와 같다.
    call("/api/v1/app-links/messages/" + msgId, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.channelKind").value("DM"))
        .andExpect(jsonPath("$.channelName").value(userName(strangerId)))
        .andExpect(jsonPath("$.authorName").value(userName(strangerId)))
        .andExpect(jsonPath("$.title").value("안녕하세요"));
    call("/api/v1/app-links/messages/" + msgId, strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.channelName").value(userName(ownerId)));

    // DM 에 없는 사람은 받지 못한다.
    call("/api/v1/app-links/messages/" + msgId, rolelessId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist());
  }

  @Test
  void 일정_링크는_제목과_시각을_주고_주최자_참석자가_아니면_404() throws Exception {
    long attendeeId = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, attendeeId, "USER");
    OffsetDateTime start = OffsetDateTime.of(2026, 11, 3, 1, 0, 0, 0, ZoneOffset.UTC);
    long eventId =
        calendarEventService
            .create(
                ownerId,
                new CalendarEventRequest(
                    "주간 회의",
                    "안건",
                    start,
                    start.plusHours(1),
                    false,
                    null,
                    null,
                    null,
                    null,
                    List.of(attendeeId),
                    null,
                    null))
            .id();
    TenantContext.set(1L);

    for (long viewer : new long[] {ownerId, attendeeId}) {
      call("/api/v1/app-links/events/" + eventId, viewer)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.kind").value("EVENT"))
          .andExpect(jsonPath("$.title").value("주간 회의"))
          .andExpect(jsonPath("$.startAt").value("2026-11-03T01:00:00Z"))
          .andExpect(jsonPath("$.endAt").value("2026-11-03T02:00:00Z"))
          .andExpect(jsonPath("$.allDay").value(false))
          .andExpect(jsonPath("$.channelName").doesNotExist());
    }

    // 주최자·참석자가 아닌 사람은 없는 일정과 같은 404·같은 문구.
    String missing = errorMessage(call("/api/v1/app-links/events/999999999", strangerId));
    call("/api/v1/app-links/events/" + eventId, strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
    // 일정 API 처럼 calendar:read 가 없으면 403 — 카드로 우회해 읽지 못한다.
    call("/api/v1/app-links/events/" + eventId, rolelessId)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.title").doesNotExist());
  }

  @Test
  void 메일_링크는_제목_보낸_사람_날짜를_주고_계정_주인이_아니면_404() throws Exception {
    long accountId = seedMailAccount(ownerId);
    long folderId = seedInbox(accountId);
    Instant sent = Instant.parse("2026-10-30T09:15:00Z");
    long mailId = seedMail(accountId, folderId, "견적 회신", "김철수", "kim@example.com", sent);
    // 제목·표시 이름이 없는 메일은 「(제목 없음)」·주소로 채운다.
    long bareId = seedMail(accountId, folderId, null, null, "noname@example.com", sent);

    call("/api/v1/app-links/mails/" + mailId, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("MAIL"))
        .andExpect(jsonPath("$.title").value("견적 회신"))
        .andExpect(jsonPath("$.authorName").value("김철수"))
        .andExpect(jsonPath("$.sentAt").value("2026-10-30T09:15:00Z"))
        .andExpect(jsonPath("$.channelKind").doesNotExist());
    call("/api/v1/app-links/mails/" + bareId, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("(제목 없음)"))
        .andExpect(jsonPath("$.authorName").value("noname@example.com"));

    // 다른 사람의 메일 계정 메일은 없는 메일과 같은 404·같은 문구.
    String missing = errorMessage(call("/api/v1/app-links/mails/999999999", strangerId));
    call("/api/v1/app-links/mails/" + mailId, strangerId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.title").doesNotExist())
        .andExpect(jsonPath("$.message").value(missing));
  }

  @Test
  void 기존_종류의_응답은_공유_링크_칸이_늘어도_그대로다() throws Exception {
    // 카드 칸이 늘어도(WP-1474) NON_NULL 이라 파일 카드는 여전히 kind·title 두 키뿐이다.
    long spaceId = driveSpaceService.createTeamSpace(ownerId, "앱링크키-" + UUID.randomUUID()).id();
    TenantContext.set(1L);
    long fileId =
        driveFileService
            .upload(
                ownerId,
                spaceId,
                null,
                new MockMultipartFile("file", "키.pdf", "application/pdf", "pdf".getBytes()))
            .id();
    Map<String, Object> body =
        JsonPath.read(
            call("/api/v1/app-links/files/" + fileId, ownerId)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(StandardCharsets.UTF_8),
            "$");
    assertThat(body.keySet()).containsExactlyInAnyOrder("kind", "title");
  }

  // --- 드라이브 공유 링크(/s/{token}, WP-1474) ---

  /** 공유 링크 카드의 대상 — 주인의 팀 공간 루트에 올린 파일. */
  private record SharedFile(long spaceId, String spaceName, long fileId) {}

  private SharedFile sharedFile() throws Exception {
    String spaceName = "앱링크공유-" + UUID.randomUUID();
    long spaceId = driveSpaceService.createTeamSpace(ownerId, spaceName).id();
    TenantContext.set(1L);
    long fileId =
        driveFileService
            .upload(
                ownerId,
                spaceId,
                null,
                new MockMultipartFile("file", "사업계획.pdf", "application/pdf", "pdf".getBytes()))
            .id();
    TenantContext.set(1L);
    return new SharedFile(spaceId, spaceName, fileId);
  }

  private String shareLink(long fileId, String audience, String password, Instant expiresAt) {
    TenantContext.set(1L);
    String token =
        shareLinkService
            .create(ownerId, fileId, new CreateShareLinkRequest(audience, password, expiresAt))
            .token();
    TenantContext.set(1L);
    return token;
  }

  @Test
  void 공유_링크는_공간_구성원에게_드라이브의_파일로_가는_MEMBER_카드를_준다() throws Exception {
    SharedFile f = sharedFile();
    // 비밀번호·사내 링크여도 구성원은 드라이브에서 열 수 있다 — 링크 상태와 무관하게 MEMBER.
    String token = shareLink(f.fileId(), "INTERNAL", "secret", null);

    call("/api/v1/app-links/shares/" + token, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("SHARE"))
        .andExpect(jsonPath("$.shareState").value("MEMBER"))
        .andExpect(jsonPath("$.title", startsWith("사업계획")))
        .andExpect(jsonPath("$.mimeType").isNotEmpty())
        .andExpect(jsonPath("$.spaceName").value(f.spaceName()))
        .andExpect(jsonPath("$.driveSpaceId").value(f.spaceId()))
        .andExpect(jsonPath("$.driveFileId").value(f.fileId()))
        // 루트 파일이라 폴더 id 는 없다. 공유 링크로 여는 사람용 칸(크기·종류·만료)도 싣지 않는다.
        .andExpect(jsonPath("$.driveFolderId").doesNotExist())
        .andExpect(jsonPath("$.sizeBytes").doesNotExist())
        .andExpect(jsonPath("$.typeLabel").doesNotExist());
  }

  @Test
  void 공유_링크는_비구성원이_열_수_있으면_OPEN_카드에_종류_크기_만료일을_주고_공간은_주지_않는다() throws Exception {
    SharedFile f = sharedFile();
    Instant until = Instant.now().plus(7, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
    String token = shareLink(f.fileId(), "EXTERNAL", null, until);

    call("/api/v1/app-links/shares/" + token, strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("SHARE"))
        .andExpect(jsonPath("$.shareState").value("OPEN"))
        .andExpect(jsonPath("$.title", startsWith("사업계획")))
        .andExpect(jsonPath("$.typeLabel").value("PDF"))
        .andExpect(jsonPath("$.sizeBytes").value(3))
        .andExpect(jsonPath("$.expiresAt").value(until.toString()))
        .andExpect(jsonPath("$.spaceName").doesNotExist())
        .andExpect(jsonPath("$.driveSpaceId").doesNotExist())
        .andExpect(jsonPath("$.driveFileId").doesNotExist());
  }

  @Test
  void 공유_링크가_비밀번호_링크면_비구성원_응답에_파일_정보가_하나도_없다() throws Exception {
    SharedFile f = sharedFile();
    String token =
        shareLink(f.fileId(), "EXTERNAL", "secret", Instant.now().plus(3, ChronoUnit.DAYS));

    Map<String, Object> body =
        JsonPath.read(
            call("/api/v1/app-links/shares/" + token, strangerId)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(StandardCharsets.UTF_8),
            "$");
    // 화면에 그리지 않는 것만으로는 부족하다 — 이름·크기·종류·형식·공간·만료일이 응답 JSON 에도 없어야 한다. 제목은 아무것도
    // 드러내지 않는 고정 문구다.
    assertThat(body)
        .containsExactlyInAnyOrderEntriesOf(
            Map.of(
                "kind", "SHARE",
                "shareState", "PASSWORD",
                "shareTarget", "FILE",
                "title", "비밀번호로 보호된 공유 파일"));
  }

  /** 폴더 공유 링크 픽스처(WP-1538) — 주인의 팀 공간에 폴더 「견적」(하위 폴더 1·파일 1)을 만들고 링크를 건다. */
  private record SharedFolder(long spaceId, String spaceName, long folderId) {}

  private SharedFolder sharedFolder() throws Exception {
    String spaceName = "앱링크폴더-" + UUID.randomUUID();
    long spaceId = driveSpaceService.createTeamSpace(ownerId, spaceName).id();
    TenantContext.set(1L);
    long folderId = driveFolderService.create(ownerId, spaceId, null, "견적").id();
    TenantContext.set(1L);
    driveFolderService.create(ownerId, spaceId, folderId, "하위");
    TenantContext.set(1L);
    driveFileService.upload(
        ownerId,
        spaceId,
        folderId,
        new MockMultipartFile("file", "a.pdf", "application/pdf", "pdf".getBytes()));
    TenantContext.set(1L);
    return new SharedFolder(spaceId, spaceName, folderId);
  }

  private String folderShareLink(long folderId, String audience, String password) {
    TenantContext.set(1L);
    String token =
        shareLinkService
            .create(
                ownerId,
                new DriveShareLinkService.Target.Folder(folderId),
                new CreateShareLinkRequest(audience, password, null))
            .token();
    TenantContext.set(1L);
    return token;
  }

  @Test
  void share_folderMember_card() throws Exception {
    SharedFolder f = sharedFolder();
    String token = folderShareLink(f.folderId(), "INTERNAL", "secret");

    call("/api/v1/app-links/shares/" + token, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("SHARE"))
        .andExpect(jsonPath("$.shareTarget").value("FOLDER"))
        .andExpect(jsonPath("$.shareState").value("MEMBER"))
        .andExpect(jsonPath("$.title").value("견적"))
        .andExpect(jsonPath("$.spaceName").value(f.spaceName()))
        .andExpect(jsonPath("$.driveSpaceId").value(f.spaceId()))
        .andExpect(jsonPath("$.driveFolderId").value(f.folderId()))
        .andExpect(jsonPath("$.folderCount").value(1))
        .andExpect(jsonPath("$.fileCount").value(1))
        .andExpect(jsonPath("$.sharedBy").isNotEmpty())
        .andExpect(jsonPath("$.driveFileId").doesNotExist());
  }

  @Test
  void share_folderOpen_card() throws Exception {
    SharedFolder f = sharedFolder();
    String token = folderShareLink(f.folderId(), "EXTERNAL", null);

    call("/api/v1/app-links/shares/" + token, strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.shareTarget").value("FOLDER"))
        .andExpect(jsonPath("$.shareState").value("OPEN"))
        .andExpect(jsonPath("$.audience").value("EXTERNAL"))
        .andExpect(jsonPath("$.title").value("견적"))
        .andExpect(jsonPath("$.folderCount").value(1))
        .andExpect(jsonPath("$.fileCount").value(1))
        .andExpect(jsonPath("$.spaceName").doesNotExist())
        .andExpect(jsonPath("$.driveSpaceId").doesNotExist())
        .andExpect(jsonPath("$.driveFolderId").doesNotExist());
  }

  @Test
  void share_folderPassword_card() throws Exception {
    SharedFolder f = sharedFolder();
    String token = folderShareLink(f.folderId(), "EXTERNAL", "secret");

    call("/api/v1/app-links/shares/" + token, strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.shareTarget").value("FOLDER"))
        .andExpect(jsonPath("$.shareState").value("PASSWORD"))
        .andExpect(jsonPath("$.title").value("비밀번호로 보호된 공유 폴더"))
        .andExpect(jsonPath("$.folderCount").doesNotExist())
        .andExpect(jsonPath("$.fileCount").doesNotExist())
        .andExpect(jsonPath("$.sharedBy").doesNotExist());
  }

  @Test
  void share_fileCard_hasShareTargetFile() throws Exception {
    SharedFile f = sharedFile();
    String token = shareLink(f.fileId(), "EXTERNAL", null, null);

    call("/api/v1/app-links/shares/" + token, strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.shareTarget").value("FILE"))
        .andExpect(jsonPath("$.folderCount").doesNotExist());
    call("/api/v1/app-links/shares/" + token, ownerId)
        .andExpect(jsonPath("$.shareTarget").value("FILE"));
  }

  @Test
  void 공유_링크가_만료_폐기됐거나_없으면_비구성원은_파일_정보_없는_410() throws Exception {
    SharedFile f = sharedFile();
    TenantContext.set(1L);
    var revoked =
        shareLinkService.create(
            ownerId, f.fileId(), new CreateShareLinkRequest("EXTERNAL", null, null));
    TenantContext.set(1L);
    shareLinkService.revoke(ownerId, revoked.id());
    TenantContext.set(1L);

    for (String token :
        List.of(revoked.token(), "sl_" + UUID.randomUUID().toString().replace("-", ""))) {
      String body =
          call("/api/v1/app-links/shares/" + token, strangerId)
              .andExpect(status().isGone())
              .andExpect(jsonPath("$.kind").doesNotExist())
              .andExpect(jsonPath("$.shareState").doesNotExist())
              .andReturn()
              .getResponse()
              .getContentAsString(StandardCharsets.UTF_8);
      // 오류 본문에도 파일 이름·공간 이름이 새지 않는다.
      assertThat(body).doesNotContain("사업계획").doesNotContain(f.spaceName());
    }
    // 폐기돼도 구성원은 드라이브의 파일로 간다.
    call("/api/v1/app-links/shares/" + revoked.token(), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.shareState").value("MEMBER"));
  }

  @Test
  void 공유_링크_토큰_문법_밖은_404_이고_비로그인은_401() throws Exception {
    // 문법 밖(접두어 없음·허용 밖 글자·65자 초과)은 서비스를 부르기 전에 404.
    for (String bad : List.of("abc", "sl_ab-c", "sl_" + "a".repeat(65), "xl_abc")) {
      call("/api/v1/app-links/shares/" + bad, strangerId)
          .andExpect(status().isNotFound())
          .andExpect(jsonPath("$.shareState").doesNotExist());
    }
    TenantContext.set(1L);
    mvc.perform(get("/api/v1/app-links/shares/sl_abc")).andExpect(status().isUnauthorized());
    TenantContext.set(1L);
  }

  /** 사용자 표시 이름 — 카드의 보낸 사람·DM 이름과 견준다. */
  private String userName(long userId) {
    return dsl.select(Tables.USER.NAME)
        .from(Tables.USER)
        .where(Tables.USER.ID.eq(userId))
        .fetchOne(Tables.USER.NAME);
  }

  /** 사용자의 메일 계정(테넌트#1) — TestFixtures.seedMailbox 와 같은 최소 행. */
  private long seedMailAccount(long userId) {
    var a = Tables.EMAIL_ACCOUNT;
    return dsl.insertInto(a, a.USER_ID, a.EMAIL_ADDRESS, a.TENANT_ID)
        .values(userId, "u" + userId + "-" + UUID.randomUUID() + "@example.com", 1L)
        .returning(a.ID)
        .fetchOne()
        .getId();
  }

  private long seedInbox(long accountId) {
    var f = Tables.EMAIL_FOLDER;
    return dsl.insertInto(f, f.ACCOUNT_ID, f.NAME, f.TENANT_ID)
        .values(accountId, "INBOX", 1L)
        .returning(f.ID)
        .fetchOne()
        .getId();
  }

  /** 동기화가 저장하는 것과 같은 경로(insertIgnoreConflict)로 메일 머리를 넣는다 — 제목은 email_content 에 들어간다. */
  private long seedMail(
      long accountId,
      long folderId,
      String subject,
      String fromName,
      String fromAddress,
      Instant sentAt) {
    String messageId = "<al-" + UUID.randomUUID() + "@test.local>";
    return emailMessageRepo
        .insertIgnoreConflict(
            accountId,
            folderId,
            new ParsedMessage(
                System.nanoTime(),
                messageId,
                "thread-" + messageId,
                null,
                null,
                fromAddress,
                fromName,
                null,
                null,
                subject,
                sentAt,
                sentAt.plus(1, ChronoUnit.MINUTES),
                false,
                false,
                null,
                null,
                null,
                List.of()))
        .orElseThrow();
  }

  /** 404 응답의 오류 문구 — 볼 수 없는 대상과 없는 대상의 응답을 견준다. */
  private static String errorMessage(ResultActions r) throws Exception {
    r.andExpect(status().isNotFound());
    return JsonPath.read(
        r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8), "$.message");
  }
}

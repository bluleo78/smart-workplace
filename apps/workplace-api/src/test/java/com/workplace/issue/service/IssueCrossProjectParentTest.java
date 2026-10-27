package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.EpicHasIncompleteChildrenException;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 다른 프로젝트 에픽을 부모로 두기(WP-1038) 통합 테스트 — 지정 규칙(에픽만·하위 태스크 불가·개인 프로젝트 불가·읽을 수 없는 프로젝트는 「찾을 수 없음」),
 * 조회자별 부모 가림(상세·목록·이력), 에픽 하위 목록의 hiddenCount, 완료 차단 메시지, 하위 재오픈의 에픽 연쇄 재오픈을 본다.
 *
 * <p>픽스처: owner 가 TEAM 프로젝트 A·B 를 가진다. memberA 는 A 의 멤버일 뿐 B 는 읽을 수 없다.
 */
@Transactional
@RecordApplicationEvents
class IssueCrossProjectParentTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService issueSearchService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectStatusRepository statusRepository;
  @Autowired ProjectService projectService;
  @Autowired ApplicationEvents events;

  private Long owner;
  private Long memberA;
  private ProjectResponse a;
  private ProjectResponse b;
  private IssueResponse epicB;

  private Long createUser(String prefix) {
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
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private ProjectResponse newProject(String prefix, String type) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        owner, new CreateProjectRequest(prefix + suffix, "P-" + prefix, "x", type));
  }

  private long typeId(ProjectResponse p, String name) {
    return typeRepository.findByProjectAndName(p.id(), name).orElseThrow().id();
  }

  /** 생성 요청 — 유형·부모 번호·부모 키만 고른다. */
  private static CreateIssueRequest req(
      String title, Long typeId, Integer parentNumber, String parentKey) {
    return new CreateIssueRequest(
        title,
        null,
        null,
        null,
        null,
        typeId,
        parentNumber,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        parentKey);
  }

  private IssueResponse task(Long caller, ProjectResponse p, String title) {
    return issueService.create(caller, p.key(), req(title, null, null, null));
  }

  private IssueResponse epic(ProjectResponse p, String title) {
    return issueService.create(owner, p.key(), req(title, typeId(p, "EPIC"), null, null));
  }

  private static String key(ProjectResponse p, IssueResponse issue) {
    return p.key() + "-" + issue.number();
  }

  @BeforeEach
  void seed() {
    owner = createUser("xo");
    memberA = createUser("xa");
    a = newProject("XA", "TEAM");
    b = newProject("XB", "TEAM");
    projectService.addMember(owner, a.key(), new AddMemberRequest(memberA, "MEMBER"));
    epicB = epic(b, "B 에픽");
  }

  @Test
  void 생성때_parentKey_로_다른_프로젝트_에픽을_부모로_둔다() {
    events.clear();
    var child = issueService.create(owner, a.key(), req("하위", null, null, key(b, epicB)));

    assertThat(child.parent()).isNotNull();
    assertThat(child.parent().number()).isEqualTo(epicB.number());
    assertThat(child.parent().projectKey()).isEqualTo(b.key());
    assertThat(child.parent().hidden()).isFalse();
    // 진행률은 프로젝트와 무관하게 모든 하위를 센다.
    assertThat(issueService.get(owner, b.key(), epicB.number()).summary().childCount())
        .isEqualTo(1);
    // 에픽 프로젝트에도 실시간 무효화가 나간다.
    assertThat(events.stream(ResourceChangedEvent.class))
        .anyMatch(e -> e.scopeId() == b.id() && e.ids().contains(epicB.id()));
  }

  @Test
  void 부모_지정을_키로_바꾸고_이력에_프로젝트_키를_남긴다() {
    var child = task(owner, a, "하위");
    events.clear();

    var detail = issueService.setParent(owner, a.key(), child.number(), null, key(b, epicB));

    assertThat(detail.summary().parent().projectKey()).isEqualTo(b.key());
    assertThat(historyRepository.findByIssue(child.id()))
        .anyMatch(
            h ->
                "PARENT_CHANGED".equals(h.eventType())
                    && h.toValue().contains("\"projectKey\":\"" + b.key() + "\""));
    assertThat(events.stream(ResourceChangedEvent.class))
        .anyMatch(e -> e.scopeId() == b.id() && e.ids().contains(epicB.id()));

    // 해제도 키 없이 된다.
    var released = issueService.setParent(owner, a.key(), child.number(), null, null);
    assertThat(released.summary().parent()).isNull();
  }

  @Test
  void 유형_변경과_함께_다른_프로젝트_에픽을_지정한다() {
    var child = task(owner, a, "하위");

    var detail =
        issueService.setType(owner, a.key(), child.number(), typeId(a, "BUG"), null, key(b, epicB));

    assertThat(detail.summary().type().name()).isEqualTo("BUG");
    assertThat(detail.summary().parent().projectKey()).isEqualTo(b.key());
  }

  @Test
  void 다른_프로젝트의_에픽이_아닌_이슈는_부모가_될_수_없다() {
    var notEpic = task(owner, b, "B 태스크");
    var child = task(owner, a, "하위");

    assertThatThrownBy(
            () -> issueService.setParent(owner, a.key(), child.number(), null, key(b, notEpic)))
        .isInstanceOf(ParentNotAllowedException.class);
  }

  @Test
  void 하위_태스크는_다른_프로젝트_부모를_가질_수_없다() {
    var parentB = task(owner, b, "B 태스크");

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner, a.key(), req("하위", typeId(a, "SUBTASK"), null, key(b, parentB))))
        .isInstanceOf(InvalidParentException.class)
        .hasMessage("하위 태스크의 부모는 같은 프로젝트 이슈여야 합니다");
  }

  @Test
  void 개인_프로젝트는_다른_프로젝트_에픽을_부모로_둘_수_없다() {
    var personal =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    var mine = issueService.create(owner, personal.key(), req("개인 이슈", null, null, null));

    assertThatThrownBy(
            () -> issueService.setParent(owner, personal.key(), mine.number(), null, key(b, epicB)))
        .isInstanceOf(InvalidParentException.class)
        .hasMessage("개인 프로젝트는 다른 프로젝트와 부모 관계를 맺을 수 없습니다");
  }

  @Test
  void 읽을_수_없는_프로젝트나_없는_키는_찾을_수_없다고_답한다() {
    var child = task(memberA, a, "하위");

    assertThatThrownBy(
            () -> issueService.setParent(memberA, a.key(), child.number(), null, key(b, epicB)))
        .isInstanceOf(InvalidParentException.class)
        .hasMessage("부모로 지정한 이슈를 찾을 수 없습니다");
    assertThatThrownBy(
            () -> issueService.setParent(owner, a.key(), child.number(), null, "NOPE9-1"))
        .isInstanceOf(InvalidParentException.class)
        .hasMessage("부모로 지정한 이슈를 찾을 수 없습니다");
    assertThatThrownBy(
            () -> issueService.setParent(owner, a.key(), child.number(), null, b.key() + "-9999"))
        .isInstanceOf(InvalidParentException.class)
        .hasMessage("부모로 지정한 이슈를 찾을 수 없습니다");
  }

  @Test
  void parentNumber_와_parentKey_가_다른_이슈를_가리키면_거절한다() {
    var epicA = epic(a, "A 에픽");
    var child = task(owner, a, "하위");

    assertThatThrownBy(
            () ->
                issueService.setParent(
                    owner, a.key(), child.number(), epicA.number(), key(b, epicB)))
        .isInstanceOf(InvalidParentException.class);
    // 같은 이슈면 받아 준다(같은 프로젝트 키는 번호 지정과 같다).
    var detail =
        issueService.setParent(owner, a.key(), child.number(), epicA.number(), key(a, epicA));
    assertThat(detail.summary().parent().number()).isEqualTo(epicA.number());
    assertThat(detail.summary().parent().projectKey()).isEqualTo(a.key());
  }

  @Test
  void 에픽_프로젝트를_읽을_수_없는_조회자에게는_부모와_이력을_가린다() {
    var child = task(owner, a, "하위");
    issueService.setParent(owner, a.key(), child.number(), null, key(b, epicB));

    // 상세 — 부모는 있다는 것만, 번호·제목·키는 없다.
    var detail = issueService.get(memberA, a.key(), child.number());
    var parent = detail.summary().parent();
    assertThat(parent.hidden()).isTrue();
    assertThat(parent.number()).isZero();
    assertThat(parent.title()).isNull();
    assertThat(parent.projectKey()).isNull();
    // 이력 — 다른 프로젝트 에픽 쪽을 가린다.
    assertThat(detail.history())
        .filteredOn(h -> "PARENT_CHANGED".equals(h.eventType()))
        .singleElement()
        .satisfies(
            h -> {
              assertThat(h.toValue()).contains("\"hidden\":true");
              assertThat(h.toValue()).doesNotContain("B 에픽").doesNotContain(b.key());
            });
    // 목록도 같다.
    var listed =
        issueSearchService.search(memberA, a.key(), Map.of()).items().stream()
            .filter(i -> i.id().equals(child.id()))
            .findFirst()
            .orElseThrow();
    assertThat(listed.parent().hidden()).isTrue();

    // 읽을 수 있는 조회자에게는 그대로다.
    var ownerView = issueService.get(owner, a.key(), child.number());
    assertThat(ownerView.summary().parent().hidden()).isFalse();
    assertThat(ownerView.summary().parent().title()).isEqualTo("B 에픽");
    assertThat(ownerView.history())
        .filteredOn(h -> "PARENT_CHANGED".equals(h.eventType()))
        .singleElement()
        .satisfies(h -> assertThat(h.toValue()).contains("B 에픽"));
  }

  @Test
  void 다른_프로젝트_에픽_아래_이슈는_자기_프로젝트의_에픽_미할당에_든다() {
    var crossChild = issueService.create(owner, a.key(), req("B 에픽 아래", null, null, key(b, epicB)));
    var epicA = epic(a, "A 에픽");
    issueService.create(owner, a.key(), req("A 에픽 아래", null, epicA.number(), null));
    task(owner, a, "부모 없음");

    // 「에픽 미할당」(topLevel + excludeEpics) — 자기 프로젝트에 묶일 에픽이 없는 다른 프로젝트 에픽 하위는 든다.
    var titles =
        issueSearchService
            .search(owner, a.key(), Map.of("topLevel", "true", "excludeEpics", "true"))
            .items()
            .stream()
            .map(IssueResponse::title)
            .toList();
    assertThat(titles).containsExactlyInAnyOrder("B 에픽 아래", "부모 없음");
    // 에픽 프로젝트 쪽에서는 여전히 그 에픽의 하위다(최상위가 아니다).
    assertThat(
            issueSearchService.search(owner, b.key(), Map.of("topLevel", "true")).items().stream()
                .map(IssueResponse::id))
        .doesNotContain(crossChild.id());
  }

  @Test
  void 에픽_하위_목록은_읽을_수_있는_하위만_싣고_나머지는_수로_센다() {
    ProjectResponse c = newProject("XC", "TEAM");
    Long memberB = createUser("xb");
    projectService.addMember(owner, b.key(), new AddMemberRequest(memberB, "MEMBER"));
    projectService.addMember(owner, a.key(), new AddMemberRequest(memberB, "MEMBER"));
    issueService.create(owner, b.key(), req("B 하위", null, epicB.number(), null));
    issueService.create(owner, a.key(), req("A 하위", null, null, key(b, epicB)));
    issueService.create(owner, c.key(), req("C 하위", null, null, key(b, epicB)));

    var children = issueSearchService.children(memberB, b.key(), epicB.number());

    assertThat(children.items())
        .extracting(IssueResponse::title)
        .containsExactlyInAnyOrder("B 하위", "A 하위");
    assertThat(children.hiddenCount()).isEqualTo(1);
    // 진행률은 볼 수 없는 하위까지 센다.
    assertThat(issueService.get(memberB, b.key(), epicB.number()).summary().childCount())
        .isEqualTo(3);
    // 소유자는 모두 본다.
    var all = issueSearchService.children(owner, b.key(), epicB.number());
    assertThat(all.items()).hasSize(3);
    assertThat(all.hiddenCount()).isZero();
  }

  @Test
  void 에픽_완료_차단_메시지는_하위마다_제_프로젝트_키를_쓰고_못_보는_하위는_수로만_센다() {
    ProjectResponse c = newProject("XC", "TEAM");
    Long memberB = createUser("xb");
    projectService.addMember(owner, b.key(), new AddMemberRequest(memberB, "MEMBER"));
    var inB = issueService.create(owner, b.key(), req("B 하위", null, epicB.number(), null));
    issueService.create(owner, c.key(), req("C 하위", null, null, key(b, epicB)));

    assertThatThrownBy(
            () -> issueService.updateStatus(memberB, b.key(), epicB.number(), IssueStatuses.DONE))
        .isInstanceOf(EpicHasIncompleteChildrenException.class)
        .hasMessage("미완료 하위 이슈가 2건 있어 완료로 변경할 수 없습니다: %s 외 1건".formatted(key(b, inB)));
  }

  @Test
  void 하위를_다시_열면_다른_프로젝트_완료_에픽을_그_프로젝트의_진행중_상태로_되돌린다() {
    // 에픽 프로젝트는 OPEN — memberA 는 읽기만 할 수 있다(쓰기 권한 없음).
    ProjectResponse open = newProject("XO", "OPEN");
    var openEpic = epic(open, "공개 에픽");
    var child = issueService.create(owner, a.key(), req("하위", null, null, key(open, openEpic)));
    issueService.updateStatus(owner, a.key(), child.number(), IssueStatuses.DONE);
    issueService.updateStatus(owner, open.key(), openEpic.number(), IssueStatuses.DONE);

    issueService.updateStatus(memberA, a.key(), child.number(), IssueStatuses.IN_PROGRESS);

    long openInProgress =
        statusRepository.findDefault(open.id(), IssueStatuses.IN_PROGRESS).orElseThrow().id();
    var epicRow =
        dsl.select(ISSUE.STATUS, ISSUE.STATUS_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(openEpic.id()))
            .fetchOne();
    assertThat(epicRow.get(ISSUE.STATUS)).isEqualTo(IssueStatuses.IN_PROGRESS);
    assertThat(epicRow.get(ISSUE.STATUS_ID)).isEqualTo(openInProgress);
  }

  @Test
  void 완료_에픽에는_다른_프로젝트_미완료_하위를_넣을_수_없다() {
    issueService.updateStatus(owner, b.key(), epicB.number(), IssueStatuses.DONE);
    var child = task(owner, a, "하위");

    assertThatThrownBy(
            () -> issueService.setParent(owner, a.key(), child.number(), null, key(b, epicB)))
        .isInstanceOf(InvalidParentException.class)
        .hasMessageContaining("완료된 에픽");
    // 아무것도 바뀌지 않았다.
    assertThat(issueService.get(owner, a.key(), child.number()).summary().parent()).isNull();
  }
}

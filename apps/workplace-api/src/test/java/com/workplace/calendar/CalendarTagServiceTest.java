package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.CalendarTagRef;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.CalendarTagResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.exception.CalendarTagDuplicateNameException;
import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.exception.ExternalEventTagNotSupportedException;
import com.workplace.calendar.exception.OutlookTagRenameNotAllowedException;
import com.workplace.calendar.repository.CalendarTagRepository;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.calendar.service.CalendarTagService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 캘린더 태그(WP-714) 통합 테스트 — 태그 CRUD, 일정에 태그 붙이기(가시성·주인·반복·외부 일정), 응답의 호출자 태그. 각 테스트는 @Transactional
 * 롤백으로 격리.
 */
@Transactional
class CalendarTagServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarTagService tags;
  @Autowired CalendarEventService events;
  @Autowired CalendarTagRepository tagRepo;

  private static final OffsetDateTime T0 = OffsetDateTime.parse("2026-07-01T01:00:00Z");

  private long seedUser(String prefix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return withMembership(
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix + " " + t)
            .set(USER.EMAIL, prefix + "_" + t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId());
  }

  private long newEvent(long owner, String title, String rrule, List<Long> attendees) {
    return events
        .create(
            owner,
            new CalendarEventRequest(
                title, null, T0, T0.plusHours(1), false, null, null, null, rrule, attendees, null))
        .id();
  }

  private long tag(long owner, String name) {
    return tags.create(owner, new CalendarTagRequest(name, null)).id();
  }

  private static List<String> names(CalendarEventResponse e) {
    return e.tags().stream().map(CalendarTagRef::name).toList();
  }

  // ── 태그 CRUD ─────────────────────────────────────────────────────────

  /** 이름은 앞뒤 공백을 떼고, 색을 안 주면 이름 해시 색(프론트 pickTagColor 와 같은 답)이 된다. 목록은 이름순·일정 수 포함. */
  @Test
  void create_trimsName_defaultsColorFromName_andListsByName() {
    long me = seedUser("me");
    CalendarTagResponse t = tags.create(me, new CalendarTagRequest("  운영 ", null));
    assertThat(t.name()).isEqualTo("운영");
    assertThat(t.color()).isEqualTo(CalendarPalette.forName("운영"));
    tags.create(me, new CalendarTagRequest("Alpha", "teal"));

    List<CalendarTagResponse> list = tags.list(me);
    assertThat(list).extracting(CalendarTagResponse::name).containsExactly("Alpha", "운영");
    assertThat(list).extracting(CalendarTagResponse::eventCount).containsExactly(0, 0);
    assertThat(list).extracting(CalendarTagResponse::hasFeed).containsExactly(false, false);
  }

  /** 이름 해시 색은 프론트 pickTagColor(calendarTag.ts)와 같아야 한다 — 같은 이름을 양쪽 테스트에 고정한다. */
  @Test
  void forName_matchesFrontendPickTagColor() {
    assertThat(CalendarPalette.forName("사내 공유")).isEqualTo("amber");
    assertThat(CalendarPalette.forName("운영")).isEqualTo("pink");
    assertThat(CalendarPalette.forName("Ops")).isEqualTo("red");
    assertThat(CalendarPalette.forName(" ops ")).isEqualTo("red");
    assertThat(CalendarPalette.forName("고객사")).isEqualTo("gray");
    assertThat(CalendarPalette.forName("Customer Meeting")).isEqualTo("green");
  }

  /** 같은 이름(대소문자 무시)은 만들기·이름 바꾸기 모두 409. 다른 사람은 같은 이름을 쓸 수 있다. */
  @Test
  void duplicateName_isConflict_caseInsensitive_perUser() {
    long me = seedUser("me");
    long other = seedUser("other");
    tag(me, "Ops");
    long second = tag(me, "운영");

    assertThatThrownBy(() -> tags.create(me, new CalendarTagRequest("ops", null)))
        .isInstanceOf(CalendarTagDuplicateNameException.class);
    assertThatThrownBy(() -> tags.update(me, second, new CalendarTagRequest("OPS", null)))
        .isInstanceOf(CalendarTagDuplicateNameException.class);
    // 다른 사용자는 같은 이름 가능
    assertThat(tag(other, "ops")).isPositive();
  }

  /** 이름 1~50자·팔레트 색만 받는다. */
  @Test
  void invalidNameOrColor_isBadRequest() {
    long me = seedUser("me");
    assertThatThrownBy(() -> tags.create(me, new CalendarTagRequest("   ", null)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> tags.create(me, new CalendarTagRequest("가".repeat(51), null)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(tags.create(me, new CalendarTagRequest("가".repeat(50), null)).name()).hasSize(50);
    assertThatThrownBy(() -> tags.create(me, new CalendarTagRequest("x", "#ff0000")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /**
   * 보이지 않는 글자만 있는 이름은 빈 이름으로 거절하고, 줄바꿈은 공백 하나로·앞뒤 보이지 않는 글자는 지워 저장한다 — 다른 이름 칸과 같은 한 줄 정리 (WP-768,
   * WP-724 빈틈). 바꾸기도 같다.
   */
  @Test
  void invisibleOnlyName_isRejected_andNameIsKeptOnOneLine() {
    long me = seedUser("me");
    for (String blank : List.of("​​", "⠀", " ​")) {
      assertThatThrownBy(() -> tags.create(me, new CalendarTagRequest(blank, null)))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("태그 이름은");
    }
    CalendarTagResponse created = tags.create(me, new CalendarTagRequest("​ 운영\n회의 ⠀", null));
    assertThat(created.name()).isEqualTo("운영 회의");

    assertThatThrownBy(() -> tags.update(me, created.id(), new CalendarTagRequest("⠀", null)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(
            tags.update(me, created.id(), new CalendarTagRequest("x\r\nX-INJECT:1", null)).name())
        .isEqualTo("x X-INJECT:1");
  }

  /** 남의 태그는 바꾸거나 지울 수 없다 — 존재 은닉 404. 내 태그는 보낸 필드만 바뀐다. */
  @Test
  void otherUsersTag_isNotFound_andPatchChangesOnlyGivenFields() {
    long me = seedUser("me");
    long other = seedUser("other");
    long mine = tags.create(me, new CalendarTagRequest("운영", "blue")).id();

    assertThatThrownBy(() -> tags.update(other, mine, new CalendarTagRequest("x", null)))
        .isInstanceOf(CalendarTagNotFoundException.class);
    assertThatThrownBy(() -> tags.delete(other, mine))
        .isInstanceOf(CalendarTagNotFoundException.class);

    CalendarTagResponse recolored = tags.update(me, mine, new CalendarTagRequest(null, "teal"));
    assertThat(recolored.name()).isEqualTo("운영");
    assertThat(recolored.color()).isEqualTo("teal");
  }

  /** Outlook 범주에서 온 50자 넘는 태그도 이름을 그대로 보내면 색만 바뀐다(화면은 늘 이름·색을 함께 보낸다). 이름을 바꾸려면 50자 이하. */
  @Test
  void longOutlookTag_canBeRecolored_withSameName() {
    long me = seedUser("me");
    String longName = "범".repeat(60);
    long id =
        tagRepo.findOrCreateByNames(me, List.of(longName), CalendarPalette::forName).get(longName);

    CalendarTagResponse recolored = tags.update(me, id, new CalendarTagRequest(longName, "teal"));
    assertThat(recolored.name()).isEqualTo(longName);
    assertThat(recolored.color()).isEqualTo("teal");
    assertThatThrownBy(() -> tags.update(me, id, new CalendarTagRequest(longName + "추가", null)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /**
   * Outlook 범주 연결이 있는 태그(fromOutlook)는 이름을 바꿀 수 없고(409 — 바꾸면 다음 동기화가 옛 이름 태그를 새로 만들어 갈라진다), 화면처럼 같은
   * 이름에 색만 바꿔 보내면 성공한다. 앱에서만 붙인 태그는 이름을 바꿀 수 있고 fromOutlook=false.
   */
  @Test
  void outlookTag_rejectsRename_butAllowsRecolor() {
    long me = seedUser("me");
    long eventId = newEvent(me, "M365 회의", null, List.of());
    long work =
        tagRepo.findOrCreateByNames(me, List.of("Work"), CalendarPalette::forName).get("Work");
    tagRepo.insertOutlookLinks(List.of(new CalendarTagRepository.EventTagLink(eventId, work)));
    long appOnly = tag(me, "앱 태그");

    assertThat(tags.list(me))
        .extracting(CalendarTagResponse::name, CalendarTagResponse::fromOutlook)
        .containsExactlyInAnyOrder(
            org.assertj.core.groups.Tuple.tuple("Work", true),
            org.assertj.core.groups.Tuple.tuple("앱 태그", false));

    assertThatThrownBy(() -> tags.update(me, work, new CalendarTagRequest("Job", "teal")))
        .isInstanceOf(OutlookTagRenameNotAllowedException.class)
        .hasMessage("Outlook 범주에서 온 태그라 이름은 Outlook에서 바꿔 주세요");
    CalendarTagResponse recolored = tags.update(me, work, new CalendarTagRequest("Work", "teal"));
    assertThat(recolored.name()).isEqualTo("Work");
    assertThat(recolored.color()).isEqualTo("teal");
    assertThat(recolored.fromOutlook()).isTrue();

    assertThat(tags.update(me, appOnly, new CalendarTagRequest("새 이름", null)).name())
        .isEqualTo("새 이름");
  }

  // ── 일정에 태그 붙이기 ────────────────────────────────────────────────────

  /** 주최자와 초대받은 사람이 같은 일정에 각자 태그를 붙이고, 응답에는 자기 태그만 보인다(목록·상세 모두). 태그 지우기는 연결을 없애고, PUT 은 교체다. */
  @Test
  void organizerAndAttendee_tagSameEvent_eachSeesOnlyOwnTags() {
    long org = seedUser("org");
    long guest = seedUser("guest");
    long eventId = newEvent(org, "주간 회의", null, List.of(guest));
    long orgTag = tag(org, "사내 공유");
    long orgTag2 = tag(org, "운영");
    long guestTag = tag(guest, "개인");

    tags.setEventTags(org, eventId, List.of(orgTag, orgTag2));
    tags.setEventTags(guest, eventId, List.of(guestTag));

    assertThat(names(events.get(org, eventId))).containsExactly("사내 공유", "운영");
    assertThat(names(events.get(guest, eventId))).containsExactly("개인");
    CalendarEventResponse listed =
        events.list(guest, T0.minusDays(1), T0.plusDays(1)).stream()
            .filter(e -> e.id() == eventId)
            .findFirst()
            .orElseThrow();
    assertThat(names(listed)).containsExactly("개인");
    assertThat(listed.tagsEditable()).isTrue();
    assertThat(tags.list(org))
        .filteredOn(t -> t.id() == orgTag)
        .first()
        .extracting(CalendarTagResponse::eventCount)
        .isEqualTo(1);

    // 교체 — 「운영」만 남긴다. 초대받은 사람의 태그는 그대로.
    tags.setEventTags(org, eventId, List.of(orgTag2));
    assertThat(names(events.get(org, eventId))).containsExactly("운영");
    assertThat(names(events.get(guest, eventId))).containsExactly("개인");

    // 태그를 지우면 일정에서도 빠진다
    tags.delete(org, orgTag2);
    assertThat(events.get(org, eventId).tags()).isEmpty();
  }

  /**
   * WP-1173: 초대받은 사람이 태그를 붙인 뒤 주최자가 그 사람을 참석자에서 빼면, 그 일정은 더 볼 수 없으니 태그 일정 수(사이드바·구독 주소 창·태그 지우기
   * 확인)에서도 빠진다. 전에는 연결 행을 그대로 세어 「1개」로 남았다. 주최자 자신의 태그 수는 그대로다.
   */
  @Test
  void removedAttendee_tagCount_excludesEventNoLongerVisible() {
    long org = seedUser("org");
    long guest = seedUser("guest");
    long eventId = newEvent(org, "빠질 회의", null, List.of(guest));
    long guestTag = tag(guest, "피드태그");
    long orgTag = tag(org, "주최");
    tags.setEventTags(guest, eventId, List.of(guestTag));
    tags.setEventTags(org, eventId, List.of(orgTag));
    assertThat(tags.list(guest)).extracting(CalendarTagResponse::eventCount).containsExactly(1);
    assertThat(tagRepo.countEvents(guestTag)).isEqualTo(1);

    events.removeAttendee(org, eventId, guest);

    assertThat(tags.list(guest)).extracting(CalendarTagResponse::eventCount).containsExactly(0);
    assertThat(tagRepo.countEvents(guestTag)).isZero();
    assertThat(tags.list(org)).extracting(CalendarTagResponse::eventCount).containsExactly(1);
    assertThat(tagRepo.countEvents(orgTag)).isEqualTo(1);
  }

  /** 남의 태그는 붙일 수 없고(404), 볼 수 없는 일정에는 붙일 수 없다(404). */
  @Test
  void setEventTags_rejectsOthersTag_andInvisibleEvent() {
    long me = seedUser("me");
    long other = seedUser("other");
    long eventId = newEvent(me, "회의", null, List.of());
    long othersTag = tag(other, "남의 태그");
    long otherEvent = newEvent(other, "남의 일정", null, List.of());
    long mine = tag(me, "내 태그");

    assertThatThrownBy(() -> tags.setEventTags(me, eventId, List.of(othersTag)))
        .isInstanceOf(CalendarTagNotFoundException.class);
    assertThatThrownBy(() -> tags.setEventTags(me, otherEvent, List.of(mine)))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  /**
   * 외부 계정에 이어지지 않은 달력의 외부 일정(external_id 만 있음)은 Outlook 에 써 넣을 곳이 없어 앱에서 태그를 붙이지 못하고(409) 응답의
   * tagsEditable 이 false 다. 내 사서함 달력의 M365 일정 써 넣기는 CalendarTagOutlookWriteTest(WP-716).
   */
  @Test
  void externalEvent_isNotTaggable() {
    long me = seedUser("me");
    long eventId = newEvent(me, "M365 회의", null, List.of());
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.EXTERNAL_ID, "graph-1")
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .execute();
    long mine = tag(me, "내 태그");

    assertThatThrownBy(() -> tags.setEventTags(me, eventId, List.of(mine)))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    assertThat(events.get(me, eventId).tagsEditable()).isFalse();
    assertThat(
            events.list(me, T0.minusDays(1), T0.plusDays(1)).stream()
                .filter(e -> e.id() == eventId)
                .findFirst()
                .orElseThrow()
                .tagsEditable())
        .isFalse();
  }

  /**
   * 반복 일정: 마스터에 붙인 태그를 가상 회차·고친 회차(오버라이드)가 따르고, 고친 회차 id 로 PUT 하면 마스터에 붙는다. 「이후 모든 일정」으로 나눈 새 시리즈도
   * 태그를 잇는다.
   */
  @Test
  void recurring_occurrencesAndOverrides_followMasterTags() {
    long me = seedUser("me");
    long guest = seedUser("guest");
    long master = newEvent(me, "데일리", "FREQ=DAILY;COUNT=6", List.of(guest));
    long a = tag(me, "A");
    long b = tag(me, "B");
    long guestTag = tag(guest, "G");
    tags.setEventTags(me, master, List.of(a));
    tags.setEventTags(guest, master, List.of(guestTag));

    // 2회차만 고친다 → 오버라이드 일정이 생긴다
    OffsetDateTime occ2 = T0.plusDays(1);
    CalendarEventResponse override =
        events.update(
            me,
            master,
            new CalendarEventRequest(
                "데일리(변경)",
                null,
                occ2.plusHours(2),
                occ2.plusHours(3),
                false,
                null,
                null,
                null,
                null,
                null,
                null),
            EditScope.THIS,
            occ2);
    assertThat(override.id()).isNotEqualTo(master);
    assertThat(names(events.get(me, override.id()))).containsExactly("A");

    // 고친 회차 id 로 PUT → 마스터에 붙어 모든 회차가 B 를 보인다
    tags.setEventTags(me, override.id(), List.of(a, b));
    List<CalendarEventResponse> listed = events.list(me, T0.minusDays(1), T0.plusDays(7));
    assertThat(listed).hasSize(6);
    assertThat(listed).allSatisfy(e -> assertThat(names(e)).containsExactly("A", "B"));
    // 초대받은 사람의 태그도 회차마다 따라간다(남의 태그는 섞이지 않음)
    assertThat(events.list(guest, T0.minusDays(1), T0.plusDays(7)))
        .allSatisfy(e -> assertThat(names(e)).containsExactly("G"));

    // 4회차부터 나눈다 → 새 마스터도 모든 사람의 태그를 잇는다
    OffsetDateTime occ4 = T0.plusDays(3);
    CalendarEventResponse split =
        events.update(
            me,
            master,
            new CalendarEventRequest(
                "데일리(후반)",
                null,
                occ4,
                occ4.plusHours(1),
                false,
                null,
                null,
                null,
                "FREQ=DAILY;COUNT=6",
                null,
                null),
            EditScope.THIS_AND_FOLLOWING,
            occ4);
    assertThat(split.id()).isNotEqualTo(master);
    assertThat(names(events.get(me, split.id()))).containsExactly("A", "B");
    assertThat(names(events.get(guest, split.id()))).containsExactly("G");
  }

  // ── 일정 저장 요청에 실린 태그(WP-801) ──────────────────────────────────────

  /** 저장 요청 — start 부터 1시간, rrule·tagIds 지정(tagIds=null 이면 태그를 건드리지 않음). */
  private static CalendarEventRequest saveReq(
      String title, OffsetDateTime start, String rrule, List<Long> tagIds) {
    return new CalendarEventRequest(
        title, null, start, start.plusHours(1), false, null, null, null, rrule, null, null, tagIds);
  }

  /** [from,to) 회차들의 내 태그 이름 목록 — 회차마다 하나씩. */
  private List<List<String>> occurrenceTags(long viewer, OffsetDateTime from, OffsetDateTime to) {
    return events.list(viewer, from, to).stream().map(CalendarTagServiceTest::names).toList();
  }

  /** 새 일정 요청에 태그를 실으면 만들면서 붙고, 응답에도 실린다. */
  @Test
  void createWithTagIds_attachesTags_inResponse() {
    long me = seedUser("me");
    long a = tag(me, "A");

    CalendarEventResponse created = events.create(me, saveReq("회의", T0, null, List.of(a)));

    assertThat(names(created)).containsExactly("A");
    assertThat(names(events.get(me, created.id()))).containsExactly("A");
  }

  /** 전체(ALL) 수정에 실은 태그는 교체이고, tagIds=null(MCP·AI 처럼 보내지 않음)이면 태그를 그대로 둔다. 다른 사람 태그도 그대로. */
  @Test
  void updateAll_replacesTags_andNullTagIdsLeavesThem() {
    long me = seedUser("me");
    long guest = seedUser("guest");
    long master = newEvent(me, "데일리", "FREQ=DAILY;COUNT=3", List.of(guest));
    long a = tag(me, "A");
    long b = tag(me, "B");
    tags.setEventTags(me, master, List.of(a));
    tags.setEventTags(guest, master, List.of(tag(guest, "G")));

    CalendarEventResponse updated =
        events.update(
            me, master, saveReq("데일리", T0, "FREQ=DAILY;COUNT=3", List.of(b)), EditScope.ALL, null);
    assertThat(names(updated)).containsExactly("B");
    assertThat(occurrenceTags(me, T0.minusDays(1), T0.plusDays(5)))
        .containsExactly(List.of("B"), List.of("B"), List.of("B"));
    assertThat(names(events.get(guest, master))).containsExactly("G");

    events.update(
        me, master, saveReq("데일리(제목만)", T0, "FREQ=DAILY;COUNT=3", null), EditScope.ALL, null);
    assertThat(names(events.get(me, master))).containsExactly("B");
  }

  /** 「이후 모든 일정」에 실은 태그는 나뉜 새 시리즈에 붙는다 — 옛 마스터가 아니라. 잘린 앞 회차는 옛 태그를 지키고, 새 시리즈도 다른 사람의 태그는 이어받는다. */
  @Test
  void updateFollowing_tagsLandOnNewSeries_earlierOccurrencesKeepOldTags() {
    long me = seedUser("me");
    long guest = seedUser("guest");
    long master = newEvent(me, "데일리", "FREQ=DAILY;COUNT=6", List.of(guest));
    long a = tag(me, "A");
    long b = tag(me, "B");
    tags.setEventTags(me, master, List.of(a));
    tags.setEventTags(guest, master, List.of(tag(guest, "G")));

    OffsetDateTime occ4 = T0.plusDays(3);
    CalendarEventResponse split =
        events.update(
            me,
            master,
            saveReq("데일리(후반)", occ4, "FREQ=DAILY;COUNT=6", List.of(b)),
            EditScope.THIS_AND_FOLLOWING,
            occ4);

    assertThat(split.id()).isNotEqualTo(master);
    assertThat(names(split)).containsExactly("B");
    assertThat(names(events.get(me, master))).containsExactly("A");
    assertThat(occurrenceTags(me, T0.minusDays(1), occ4))
        .containsExactly(List.of("A"), List.of("A"), List.of("A"));
    assertThat(occurrenceTags(me, occ4, T0.plusDays(7)))
        .containsExactly(List.of("B"), List.of("B"), List.of("B"));
    assertThat(names(events.get(guest, split.id()))).containsExactly("G");
  }

  /** 첫 회차에서 「이후 모든 일정」으로 고치면 옛 시리즈는 지워진다 — 태그는 새 시리즈에 붙어 404 가 나지 않는다(옛 마스터를 노리던 버그). */
  @Test
  void updateFollowing_fromFirstOccurrence_tagsNewSeries_withoutNotFound() {
    long me = seedUser("me");
    long master = newEvent(me, "데일리", "FREQ=DAILY;COUNT=3", List.of());
    long a = tag(me, "A");
    tags.setEventTags(me, master, List.of(a));
    long b = tag(me, "B");

    CalendarEventResponse split =
        events.update(
            me,
            master,
            saveReq("데일리(새)", T0, "FREQ=DAILY;COUNT=3", List.of(a, b)),
            EditScope.THIS_AND_FOLLOWING,
            T0);

    assertThat(names(split)).containsExactly("A", "B");
    assertThatThrownBy(() -> events.get(me, master))
        .isInstanceOf(CalendarEventNotFoundException.class);
    assertThat(occurrenceTags(me, T0.minusDays(1), T0.plusDays(5)))
        .containsExactly(List.of("A", "B"), List.of("A", "B"), List.of("A", "B"));
  }

  /** 「이 일정만」이어도 태그는 시리즈 단위라 마스터에 붙는다 — 고친 회차와 다른 회차 모두 새 태그를 보인다. */
  @Test
  void updateThis_appliesTagsToSeries() {
    long me = seedUser("me");
    long master = newEvent(me, "데일리", "FREQ=DAILY;COUNT=3", List.of());
    long a = tag(me, "A");
    tags.setEventTags(me, master, List.of(a));
    long b = tag(me, "B");

    OffsetDateTime occ2 = T0.plusDays(1);
    CalendarEventResponse override =
        events.update(me, master, saveReq("데일리(변경)", occ2, null, List.of(b)), EditScope.THIS, occ2);

    assertThat(override.id()).isNotEqualTo(master);
    assertThat(names(override)).containsExactly("B");
    assertThat(names(events.get(me, master))).containsExactly("B");
    assertThat(occurrenceTags(me, T0.minusDays(1), T0.plusDays(5)))
        .containsExactly(List.of("B"), List.of("B"), List.of("B"));
  }

  /** 남의 태그를 실은 저장은 404 이고 일정은 만들어지지도·바뀌지도 않는다 — 태그를 쓰기 전에 확인한다. */
  @Test
  void saveWithOthersTag_isRejectedBeforeWriting() {
    long me = seedUser("me");
    long other = seedUser("other");
    long othersTag = tag(other, "남의 태그");
    long eventId = newEvent(me, "회의", null, List.of());

    assertThatThrownBy(() -> events.create(me, saveReq("새 회의", T0, null, List.of(othersTag))))
        .isInstanceOf(CalendarTagNotFoundException.class);
    assertThat(events.list(me, T0.minusDays(1), T0.plusDays(1)))
        .extracting(CalendarEventResponse::title)
        .containsExactly("회의");

    assertThatThrownBy(
            () ->
                events.update(
                    me,
                    eventId,
                    saveReq("바뀐 제목", T0, null, List.of(othersTag)),
                    EditScope.ALL,
                    null))
        .isInstanceOf(CalendarTagNotFoundException.class);
    assertThat(events.get(me, eventId).title()).isEqualTo("회의");
  }

  /** 범주를 써 넣을 수 없는 외부 일정에 태그를 실으면 PUT 과 같은 409 — 일정 본문도 바뀌지 않는다. */
  @Test
  void saveWithTags_onUntaggableExternalEvent_isConflict_andEventUnchanged() {
    long me = seedUser("me");
    long eventId = newEvent(me, "M365 회의", null, List.of());
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.EXTERNAL_ID, "graph-1")
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .execute();
    long mine = tag(me, "내 태그");

    assertThatThrownBy(
            () ->
                events.update(
                    me, eventId, saveReq("바뀐 제목", T0, null, List.of(mine)), EditScope.ALL, null))
        .isInstanceOf(ExternalEventTagNotSupportedException.class);
    assertThat(events.get(me, eventId).title()).isEqualTo("M365 회의");
  }
}

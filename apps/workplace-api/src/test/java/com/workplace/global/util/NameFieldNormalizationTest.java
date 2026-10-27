package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.UpdateExternalContactRequest;
import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.drive.dto.CreateFolderRequest;
import com.workplace.drive.dto.CreateTextFileRequest;
import com.workplace.drive.dto.RenameFileRequest;
import com.workplace.drive.dto.RenameFolderRequest;
import com.workplace.drive.dto.RenameSpaceRequest;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.messaging.dto.CreateChannelRequest;
import com.workplace.messaging.dto.RenameChannelRequest;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.UpdateProjectRequest;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.view.dto.SaveViewRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/**
 * 이름 칸 정규화(WP-628, WP-671) — 프로젝트·사이클·마일스톤·라벨·외부 연락처·그룹, 채널·드라이브·노트 스페이스·필드·유형·저장 뷰·캘린더·일정 이름이 앞뒤
 * 공백·제로폭 문자(U+200B)를 다듬고, 다듬은 결과가 비면 한국어 안내로 거절되는지. 예전엔 제로폭 한 글자 이름이 저장돼 목록에 이름이 빈 줄이 생겼고, 공백만 보내면
 * 「must not be blank」 영어 원문이 왔다.
 */
class NameFieldNormalizationTest {

  private static final jakarta.validation.ValidatorFactory FACTORY =
      Validation.buildDefaultValidatorFactory();
  private static final Validator VALIDATOR = FACTORY.getValidator();

  @AfterAll
  static void close() {
    FACTORY.close();
  }

  /** 이름 하나로 요청을 만드는 방법과, 만든 요청에서 이름을 꺼내는 방법. field 는 검증 오류가 붙는 칸 이름(일정은 title). */
  private record Case(
      String label, Function<String, Object> make, Function<Object, String> name, String field) {
    Case(String label, Function<String, Object> make, Function<Object, String> name) {
      this(label, make, name, "name");
    }
  }

  private static final List<Case> CASES =
      List.of(
          new Case(
              "프로젝트 만들기",
              n -> new CreateProjectRequest("AB", n, null),
              r -> ((CreateProjectRequest) r).name()),
          new Case(
              "프로젝트 이름 바꾸기",
              n -> new UpdateProjectRequest(n, null, null, null, null),
              r -> ((UpdateProjectRequest) r).name()),
          new Case(
              "사이클",
              n -> new CreateCycleRequest(n, null, null, null, null),
              r -> ((CreateCycleRequest) r).name()),
          new Case(
              "마일스톤",
              n -> new CreateMilestoneRequest(n, LocalDate.of(2026, 11, 30), null),
              r -> ((CreateMilestoneRequest) r).name()),
          new Case(
              "라벨", n -> new CreateLabelRequest(n, "RED"), r -> ((CreateLabelRequest) r).name()),
          new Case(
              "외부 연락처",
              n -> new ExternalContactRequest(n, null, null, null, null, null, "PERSONAL"),
              r -> ((ExternalContactRequest) r).name()),
          new Case(
              "외부 연락처 수정",
              n -> new UpdateExternalContactRequest(n, null, null, null, null, null, null),
              r -> ((UpdateExternalContactRequest) r).name()),
          new Case(
              "그룹",
              n -> new CreateUserGroupRequest(n, null, "PERSONAL", null, null),
              r -> ((CreateUserGroupRequest) r).name()),
          new Case(
              "그룹 수정",
              n -> new UpdateUserGroupRequest(n, null, null, null, null, null),
              r -> ((UpdateUserGroupRequest) r).name()),
          // WP-671 — 채널·드라이브·노트 스페이스·필드·유형·저장 뷰·캘린더·일정
          new Case(
              "채널 만들기",
              n -> new CreateChannelRequest(n, null),
              r -> ((CreateChannelRequest) r).name()),
          new Case(
              "채널 이름 바꾸기",
              n -> new RenameChannelRequest(n),
              r -> ((RenameChannelRequest) r).name()),
          new Case(
              "드라이브 공간 만들기",
              n -> new com.workplace.drive.dto.CreateSpaceRequest(n),
              r -> ((com.workplace.drive.dto.CreateSpaceRequest) r).name()),
          new Case(
              "드라이브 공간 이름 바꾸기",
              n -> new RenameSpaceRequest(n),
              r -> ((RenameSpaceRequest) r).name()),
          new Case(
              "드라이브 폴더 만들기",
              n -> new CreateFolderRequest(null, n),
              r -> ((CreateFolderRequest) r).name()),
          new Case(
              "드라이브 폴더 이름 바꾸기",
              n -> new RenameFolderRequest(n),
              r -> ((RenameFolderRequest) r).name()),
          new Case(
              "드라이브 텍스트 파일 만들기",
              n -> new CreateTextFileRequest(null, n, "x", null),
              r -> ((CreateTextFileRequest) r).name()),
          new Case(
              "드라이브 파일 이름 바꾸기", n -> new RenameFileRequest(n), r -> ((RenameFileRequest) r).name()),
          new Case(
              "노트 스페이스",
              n -> new com.workplace.wiki.dto.CreateSpaceRequest(n),
              r -> ((com.workplace.wiki.dto.CreateSpaceRequest) r).name()),
          new Case(
              "필드",
              n -> new CreateIssueFieldDefRequest(n, "TEXT", null),
              r -> ((CreateIssueFieldDefRequest) r).name()),
          new Case(
              "유형",
              n -> new CreateIssueTypeRequest(n, "RED", "bug"),
              r -> ((CreateIssueTypeRequest) r).name()),
          new Case(
              "저장 뷰",
              n -> new SaveViewRequest(n, "status=TODO", null),
              r -> ((SaveViewRequest) r).name()),
          new Case(
              "캘린더", n -> new CalendarRequest(n, "blue", null), r -> ((CalendarRequest) r).name()),
          new Case(
              "일정",
              n ->
                  new CalendarEventRequest(
                      n,
                      null,
                      OffsetDateTime.parse("2026-10-22T03:00:00Z"),
                      OffsetDateTime.parse("2026-10-22T04:00:00Z"),
                      false,
                      null,
                      null,
                      null,
                      null,
                      null,
                      null),
              r -> ((CalendarEventRequest) r).title(),
              "title"));

  private static Map<String, String> violations(Object req) {
    return VALIDATOR.validate(req).stream()
        .collect(
            Collectors.toMap(
                v -> v.getPropertyPath().toString(), ConstraintViolation::getMessage, (a, b) -> a));
  }

  @Test
  void 앞뒤_공백과_제로폭_문자를_다듬는다() {
    for (Case c : CASES) {
      Object req = c.make().apply("​  기획팀 회의 ​\n");
      assertThat(c.name().apply(req)).as(c.label()).isEqualTo("기획팀 회의");
      assertThat(violations(req)).as(c.label()).doesNotContainKey(c.field());
    }
  }

  @Test
  void 다듬어서_비면_한국어_안내로_거절한다() {
    for (Case c : CASES) {
      for (String blank : List.of("​", "​​", "   ", "　")) {
        Map<String, String> v = violations(c.make().apply(blank));
        assertThat(v).as(c.label() + " [" + blank + "]").containsKey(c.field());
        assertThat(v.get(c.field()))
            .as(c.label() + " [" + blank + "]")
            .doesNotContain("must")
            .containsAnyOf("이름", "제목");
      }
    }
  }
}

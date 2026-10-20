package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.UpdateExternalContactRequest;
import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.UpdateProjectRequest;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/**
 * 이름 칸 정규화(WP-628) — 프로젝트·사이클·마일스톤·라벨·외부 연락처·그룹 이름이 앞뒤 공백·제로폭 문자(U+200B)를 다듬고, 다듬은 결과가 비면 한국어 안내로
 * 거절되는지. 예전엔 제로폭 한 글자 이름이 저장돼 목록에 이름이 빈 줄이 생겼고, 공백만 보내면 「must not be blank」 영어 원문이 왔다.
 */
class NameFieldNormalizationTest {

  private static final jakarta.validation.ValidatorFactory FACTORY =
      Validation.buildDefaultValidatorFactory();
  private static final Validator VALIDATOR = FACTORY.getValidator();

  @AfterAll
  static void close() {
    FACTORY.close();
  }

  /** 이름 하나로 요청을 만드는 방법과, 만든 요청에서 이름을 꺼내는 방법. */
  private record Case(String label, Function<String, Object> make, Function<Object, String> name) {}

  private static final List<Case> CASES =
      List.of(
          new Case(
              "프로젝트 만들기",
              n -> new CreateProjectRequest("AB", n, null),
              r -> ((CreateProjectRequest) r).name()),
          new Case(
              "프로젝트 이름 바꾸기",
              n -> new UpdateProjectRequest(n, null, null),
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
              r -> ((UpdateUserGroupRequest) r).name()));

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
      assertThat(violations(req)).as(c.label()).doesNotContainKey("name");
    }
  }

  @Test
  void 다듬어서_비면_한국어_안내로_거절한다() {
    for (Case c : CASES) {
      for (String blank : List.of("​", "​​", "   ", "　")) {
        Map<String, String> v = violations(c.make().apply(blank));
        assertThat(v).as(c.label() + " [" + blank + "]").containsKey("name");
        assertThat(v.get("name"))
            .as(c.label() + " [" + blank + "]")
            .doesNotContain("must")
            .contains("이름");
      }
    }
  }
}

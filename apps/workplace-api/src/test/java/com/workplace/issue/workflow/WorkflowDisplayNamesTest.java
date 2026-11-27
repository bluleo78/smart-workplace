package com.workplace.issue.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.workflow.domain.WorkflowDisplayNames;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** WP-2158 표시 이름 해석 — name 이 있으면 name, 없으면 질문 줄임의 기본 이름, 그 밖은 key. */
class WorkflowDisplayNamesTest {

  @Test
  @DisplayName("결과: name 이 있으면 name, 비었거나 없으면 key")
  void outcome_nameOrKey() {
    assertThat(WorkflowDisplayNames.outcome("approve", "승인")).isEqualTo("승인");
    assertThat(WorkflowDisplayNames.outcome("approve", null)).isEqualTo("approve");
    assertThat(WorkflowDisplayNames.outcome("approve", "")).isEqualTo("approve");
    // 공백뿐인 name 도 비어 있는 것으로 본다(웹 trim 과 같은 규칙)
    assertThat(WorkflowDisplayNames.outcome("approve", "  ")).isEqualTo("approve");
    assertThat(WorkflowDisplayNames.outcome("ask", " ")).isEqualTo("질문");
  }

  @Test
  @DisplayName("결과: 질문 줄임 ask·answered 는 기본 이름, name 이 있으면 name 이 앞선다")
  void outcome_askShorthand() {
    assertThat(WorkflowDisplayNames.outcome("ask", null)).isEqualTo("질문");
    assertThat(WorkflowDisplayNames.outcome("_recover", null)).isEqualTo("조치");
    assertThat(WorkflowDisplayNames.outcome("answered", null)).isEqualTo("답변");
    assertThat(WorkflowDisplayNames.outcome("ask", "물어보기")).isEqualTo("물어보기");
  }

  @Test
  @DisplayName("key 가 null 이면 null")
  void outcome_nullKey() {
    assertThat(WorkflowDisplayNames.outcome(null, null)).isNull();
  }

  @Test
  @DisplayName("출력: name 아니면 key")
  void output_nameOrKey() {
    assertThat(WorkflowDisplayNames.output("tag", null)).isEqualTo("tag");
    assertThat(WorkflowDisplayNames.output("tag", "태그")).isEqualTo("태그");
    assertThat(WorkflowDisplayNames.output("tag", " ")).isEqualTo("tag");
  }
}

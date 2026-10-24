package com.workplace.view.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * 저장된 뷰 쿼리의 상태 id 치환(WP-809) 순수 테스트 — 웹은 URLSearchParams 로 저장해 쉼표가 %2C 로 인코딩돼 있을 수 있고, 다른 파라미터는 원문
 * 그대로 남아야 한다.
 */
class SavedViewQueriesTest {

  @Test
  void 쉼표CSV의_id를_바꾸고_중복을_없앤다() {
    assertThat(SavedViewQueries.replaceStatus("statusId=12,13&view=board", 12, 13L))
        .isEqualTo("statusId=13&view=board");
  }

  @Test
  void 인코딩된_쉼표도_처리한다() {
    assertThat(SavedViewQueries.replaceStatus("statusId=12%2C14", 12, 13L))
        .isEqualTo("statusId=13%2C14");
    // 소문자 %2c 도 같은 쉼표다
    assertThat(SavedViewQueries.replaceStatus("statusId=14%2c12", 12, 13L))
        .isEqualTo("statusId=14%2C13");
  }

  @Test
  void toId가_null이면_빼고_비면_파라미터를_지운다() {
    assertThat(SavedViewQueries.replaceStatus("statusId=12&q=x", 12, null)).isEqualTo("q=x");
    assertThat(SavedViewQueries.replaceStatus("q=x&statusId=12%2C14", 12, null))
        .isEqualTo("q=x&statusId=14");
    // 쿼리가 통째로 비면 저장 가능한 중립 쿼리(웹이 「그룹 없음」으로 읽는 기본 뷰)로
    assertThat(SavedViewQueries.replaceStatus("statusId=12", 12, null)).isEqualTo("group=none");
  }

  @Test
  void boardTab도_바꾼다() {
    assertThat(SavedViewQueries.replaceStatus("boardTab=12", 12, 13L)).isEqualTo("boardTab=13");
    assertThat(SavedViewQueries.replaceStatus("boardTab=12", 12, null)).isEqualTo("group=none");
    assertThat(SavedViewQueries.replaceStatus("view=board&boardTab=12", 12, null))
        .isEqualTo("view=board");
  }

  @Test
  void 다른_파라미터와_순서는_그대로() {
    String q = "status=DONE&statusId=7&group=status";
    assertThat(SavedViewQueries.replaceStatus(q, 12, 13L)).isEqualTo(q);
    // 지울 id 가 없으면 쉼표 표기도 바꾸지 않는다(바뀐 뷰로 잘못 세지 않게)
    assertThat(SavedViewQueries.replaceStatus("statusId=7,8&q=a%20b", 12, 13L))
        .isEqualTo("statusId=7,8&q=a%20b");
    // 다른 파라미터의 인코딩·「+」는 원문 그대로
    assertThat(SavedViewQueries.replaceStatus("q=a+b%2Cc&statusId=12&boardTab=120", 12, 13L))
        .isEqualTo("q=a+b%2Cc&statusId=13&boardTab=120");
    assertThat(SavedViewQueries.replaceStatus(null, 12, 13L)).isNull();
    // 원래 비어 있던(바뀔 것이 없는) 쿼리는 손대지 않는다
    assertThat(SavedViewQueries.replaceStatus("", 12, 13L)).isEmpty();
  }

  @Test
  void references는_statusId와_boardTab을_본다() {
    assertThat(SavedViewQueries.references("statusId=12,13", 12)).isTrue();
    assertThat(SavedViewQueries.references("statusId=13%2C12", 12)).isTrue();
    assertThat(SavedViewQueries.references("boardTab=12", 12)).isTrue();
    assertThat(SavedViewQueries.references("statusId=120&boardTab=1", 12)).isFalse();
    assertThat(SavedViewQueries.references("q=12&status=DONE", 12)).isFalse();
    assertThat(SavedViewQueries.references(null, 12)).isFalse();
  }

  @Test
  void emptiesStatusFilter는_id를_빼면_statusId가_비는지_본다() {
    assertThat(SavedViewQueries.emptiesStatusFilter("statusId=12&q=x", 12)).isTrue();
    assertThat(SavedViewQueries.emptiesStatusFilter("statusId=12%2C12", 12)).isTrue();
    assertThat(SavedViewQueries.emptiesStatusFilter("statusId=12%2C13", 12)).isFalse();
    // boardTab 은 필터가 아니라 모바일 선택 탭이라 세지 않는다
    assertThat(SavedViewQueries.emptiesStatusFilter("boardTab=12", 12)).isFalse();
    assertThat(SavedViewQueries.emptiesStatusFilter("statusId=13", 12)).isFalse();
  }
}

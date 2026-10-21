package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.service.CalendarTransport.LiveCategories;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 태그 → Outlook 범주 써 넣기의 순수 규칙(WP-716 리뷰) — 지금 범주에 차이만 반영하기, 써 넣을 Graph 대상 고르기. DB·Graph 없이 고정한다.
 */
class CalendarTagOutlookMergeTest {

  /** 앱이 모르는 범주는 남고, 손대지 않은 범주는 Outlook 표기(앞뒤 공백·대소문자) 그대로, 뺄 이름은 대소문자·앞뒤 공백을 무시하고 지운다. */
  @Test
  void merge_keepsUnknownAndExactLiveStrings_removesCaseInsensitively() {
    List<String> merged =
        CalendarTagService.mergeCategories(
            List.of(" Project X ", "OPS", "Outlook만"), List.of("고객사"), List.of(" ops"));
    assertThat(merged).containsExactly(" Project X ", "Outlook만", "고객사");
  }

  /** 이미 있는 범주(대소문자만 다름)를 더하면 Outlook 표기를 두고 다시 붙이지 않는다 — 결과가 그대로면 PATCH 를 건너뛸 수 있다. */
  @Test
  void merge_addingExistingNameWithOtherCase_isNoOp() {
    List<String> live = List.of("ops", "Work");
    assertThat(CalendarTagService.mergeCategories(live, List.of("OPS"), List.of())).isEqualTo(live);
  }

  /** 빼려는 범주가 이미 Outlook 에서 빠졌어도 문제없고, 모두 빼면 빈 목록(= 모든 범주 떼기)이다. */
  @Test
  void merge_removingMissingOrAll() {
    assertThat(CalendarTagService.mergeCategories(List.of("a"), List.of(), List.of("b")))
        .containsExactly("a");
    assertThat(CalendarTagService.mergeCategories(List.of("a", "B"), List.of(), List.of("A", "b")))
        .isEmpty();
  }

  /** 보통 회차 → 시리즈 마스터만, 고친 회차 → 자신과 마스터, 단일·모름·마스터 id 없음 → 자기 자신. */
  @Test
  void targets_followLiveType() {
    assertThat(new LiveCategories("occurrence", "SM", List.of()).targets("occ"))
        .containsExactly("SM");
    assertThat(new LiveCategories("exception", "SM", List.of()).targets("exc"))
        .containsExactly("exc", "SM");
    assertThat(new LiveCategories("singleInstance", null, List.of()).targets("one"))
        .containsExactly("one");
    assertThat(new LiveCategories(null, null, List.of()).targets("x")).containsExactly("x");
    assertThat(new LiveCategories("occurrence", null, List.of()).targets("occ"))
        .containsExactly("occ");
  }

  /** 시리즈에 쓰는 경우는 마스터 id 가 있는 보통 회차·고친 회차뿐이다. */
  @Test
  void writesSeries_onlyForOccurrenceAndExceptionWithMaster() {
    assertThat(new LiveCategories("occurrence", "SM", List.of()).writesSeries()).isTrue();
    assertThat(new LiveCategories("exception", "SM", List.of()).writesSeries()).isTrue();
    assertThat(new LiveCategories("occurrence", null, List.of()).writesSeries()).isFalse();
    assertThat(new LiveCategories("seriesMaster", "SM", List.of()).writesSeries()).isFalse();
  }
}

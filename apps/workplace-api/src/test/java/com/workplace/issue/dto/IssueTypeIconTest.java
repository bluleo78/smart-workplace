package com.workplace.issue.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.InvalidTypeIconException;
import org.junit.jupiter.api.Test;

/** 아이콘 화이트리스트 8종 검증. */
class IssueTypeIconTest {

  @Test
  void all_8_icons_accepted() {
    for (String n :
        new String[] {"Circle", "Bug", "BookOpen", "Wrench", "Star", "Zap", "Flag", "Target"}) {
      assertThat(IssueTypeIcon.validate(n)).isEqualTo(n);
    }
  }

  @Test
  void unknown_icon_throws() {
    assertThatThrownBy(() -> IssueTypeIcon.validate("Heart"))
        .isInstanceOf(InvalidTypeIconException.class);
  }

  @Test
  void null_or_blank_throws() {
    assertThatThrownBy(() -> IssueTypeIcon.validate(null))
        .isInstanceOf(InvalidTypeIconException.class);
    assertThatThrownBy(() -> IssueTypeIcon.validate(""))
        .isInstanceOf(InvalidTypeIconException.class);
  }
}

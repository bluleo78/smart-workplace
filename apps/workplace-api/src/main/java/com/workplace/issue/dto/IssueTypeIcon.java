package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidTypeIconException;
import java.util.Set;

/** lucide 아이콘 화이트리스트 8종. 이 외 이름은 검증 단계에서 차단된다. */
public final class IssueTypeIcon {
  private IssueTypeIcon() {}

  /** 허용되는 아이콘 이름 집합. lucide 컴포넌트명과 1:1 매칭. */
  public static final Set<String> ALL =
      Set.of("Circle", "Bug", "BookOpen", "Wrench", "Star", "Zap", "Flag", "Target");

  /** 화이트리스트에 포함되면 그대로 반환, 아니면 {@link InvalidTypeIconException}. */
  public static String validate(String icon) {
    if (icon == null || icon.isBlank() || !ALL.contains(icon)) {
      throw new InvalidTypeIconException(icon);
    }
    return icon;
  }
}

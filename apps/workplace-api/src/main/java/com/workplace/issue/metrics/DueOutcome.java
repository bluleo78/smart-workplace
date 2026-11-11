package com.workplace.issue.metrics;

/** 완료 이슈 한 건의 마감 판정(WP-1476) — 닫힌 서울 날짜와 「닫힐 당시 마감일」을 비교한다. 닫힌 뒤 마감일을 바꿔도 판정은 바뀌지 않는다. */
public enum DueOutcome {
  /** 닫힌 날 ≤ 닫힐 당시 마감일. */
  ON_TIME,
  /** 닫힌 날 &gt; 닫힐 당시 마감일. */
  OVERDUE,
  /** 닫힐 당시 마감일이 없었다. */
  NO_DUE
}

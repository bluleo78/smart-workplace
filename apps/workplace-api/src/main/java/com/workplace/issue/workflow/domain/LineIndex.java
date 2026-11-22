package com.workplace.issue.workflow.domain;

import java.util.Arrays;

/**
 * 코드 포인트 인덱스 → 편집기 기준 줄·열 변환표.
 *
 * <p>왜: SnakeYAML Mark 는 코드 포인트를 세고 U+0085·U+2028 같은 문자도 줄 바꿈으로 본다. 편집기(자바스크립트 문자열 기준)는 줄 바꿈이
 * \n·\r\n·\r 뿐이고 열을 UTF-16 단위로 센다. 그래서 Mark 의 줄·열을 쓰지 않고 인덱스만 받아 이 표로 다시 계산한다. 전체를 한 번 훑어 줄 시작과
 * UTF-16 누적 단위를 만들어 두므로 한 줄이 아주 긴 문서에서도 조회가 O(log 줄 수)다.
 */
final class LineIndex {

  /** 각 줄이 시작하는 코드 포인트 인덱스(오름차순). */
  private final int[] lineStart;

  /** units[i] = 코드 포인트 i 앞까지의 UTF-16 단위 수(길이 n+1). */
  private final int[] units;

  /** 코드 포인트 개수. */
  private final int count;

  LineIndex(int[] codePoints) {
    this.count = codePoints.length;
    this.units = new int[count + 1];
    int lines = 1;
    for (int i = 0; i < count; i++) {
      units[i + 1] = units[i] + Character.charCount(codePoints[i]);
      int c = codePoints[i];
      if (c == '\n' || (c == '\r' && !(i + 1 < count && codePoints[i + 1] == '\n'))) {
        lines++;
      }
    }
    this.lineStart = new int[lines];
    int line = 1;
    for (int i = 0; i < count; i++) {
      int c = codePoints[i];
      if (c == '\n' || (c == '\r' && !(i + 1 < count && codePoints[i + 1] == '\n'))) {
        lineStart[line++] = i + 1;
      }
    }
  }

  /** 코드 포인트 인덱스의 위치(1 부터). 범위를 벗어나면 문서 끝으로 맞춘다. */
  SourceMap.Pos at(int index) {
    int i = Math.max(0, Math.min(index, count));
    int found = Arrays.binarySearch(lineStart, i);
    int line = found >= 0 ? found : -found - 2;
    int column = units[i] - units[lineStart[line]];
    return new SourceMap.Pos(line + 1, column + 1);
  }
}

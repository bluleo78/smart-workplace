package com.workplace.drive.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.workplace.drive.exception.DriveFileNotFoundException;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;

/**
 * 드라이브 파일 id 존재 은닉 검증 도우미(WP-1421·WP-1422). 볼 수 없는 파일 요청과 없는 파일 요청이 같은 예외·같은 문구여야 응답만으로 그 id 의 파일이
 * 있는지 알 수 없다.
 */
final class DriveExistenceHiding {

  private DriveExistenceHiding() {}

  /**
   * 두 호출이 모두 {@link DriveFileNotFoundException} 을 같은 문구로 던지는지 확인한다.
   *
   * @param hidden 있지만 볼 수 없는 파일 id 로 부르는 호출(비멤버)
   * @param absent 없는 파일 id 로 부르는 호출
   */
  static void assertHiddenLikeMissing(ThrowingCallable hidden, ThrowingCallable absent) {
    Throwable h = catchThrowable(hidden);
    Throwable a = catchThrowable(absent);
    assertThat(h).isInstanceOf(DriveFileNotFoundException.class);
    assertThat(a).isInstanceOf(DriveFileNotFoundException.class);
    assertThat(h.getMessage()).isEqualTo(a.getMessage());
  }
}

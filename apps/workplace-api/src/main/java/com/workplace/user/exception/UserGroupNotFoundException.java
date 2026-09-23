package com.workplace.user.exception;

/** 그룹 미존재 또는 PERSONAL 격리 위반(타인 소유) 시. 존재 은닉을 위해 격리 위반도 404 로 매핑한다. */
public class UserGroupNotFoundException extends RuntimeException {
  public UserGroupNotFoundException(long id) {
    super("그룹을 찾을 수 없습니다 (id: " + id + ")");
  }
}

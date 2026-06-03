package com.workplace.contacts.exception;

/** 연락처 미존재 또는 접근 격리(PERSONAL 타인) 시. 존재 은닉을 위해 격리 위반도 404 로 매핑한다. */
public class ContactNotFoundException extends RuntimeException {
  public ContactNotFoundException(String type, long id) {
    super("contact " + type + " " + id + " not found");
  }
}

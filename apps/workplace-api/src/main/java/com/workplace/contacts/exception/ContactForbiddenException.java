package com.workplace.contacts.exception;

/** SHARED 연락처에 대한 비-owner 쓰기 시도 등 접근 금지(403). PERSONAL 타인은 404(존재 은닉)를 쓴다. */
public class ContactForbiddenException extends RuntimeException {
  public ContactForbiddenException(long id, long userId) {
    super("user " + userId + " forbidden to modify contact " + id);
  }
}

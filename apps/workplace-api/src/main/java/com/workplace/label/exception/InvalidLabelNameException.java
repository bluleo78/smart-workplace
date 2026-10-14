package com.workplace.label.exception;

/** 이름으로 붙이며 만들 라벨의 이름이 비었거나 너무 길 때(WP-394) — IllegalArgumentException 이라 400 으로 매핑된다. */
public class InvalidLabelNameException extends IllegalArgumentException {
  public InvalidLabelNameException(String message) {
    super(message);
  }
}

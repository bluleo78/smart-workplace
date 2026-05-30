package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 세션이 없거나 호출자 소유가 아님(존재 노출 방지 위해 404 통일). */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class HomeSessionNotFoundException extends RuntimeException {
  public HomeSessionNotFoundException(java.util.UUID id) {
    super("home session not found: " + id);
  }
}

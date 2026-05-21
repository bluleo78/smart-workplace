package com.workplace.file.exception;

public class UnsupportedUploadFileTypeException extends RuntimeException {
  public UnsupportedUploadFileTypeException(String mimeType) {
    super("Unsupported file type: " + mimeType);
  }
}

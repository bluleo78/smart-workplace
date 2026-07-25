"""soffice 변환 모듈 단위 테스트 — 실제 LibreOffice 없이 실패 전파를 검증한다."""
import subprocess
from unittest.mock import patch

import pytest

from app import soffice


def test_timeout_raises_runtime_error():
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="soffice", timeout=60)):
        with pytest.raises(RuntimeError, match="타임아웃"):
            soffice.convert_to_text(b"data", ".doc")


def test_nonzero_returncode_raises():
    class P:
        returncode = 1
        stdout = b""
        stderr = b"boom"

    with patch("subprocess.run", return_value=P()):
        with pytest.raises(RuntimeError, match="변환 실패"):
            soffice.convert_to_text(b"data", ".doc")


def test_missing_output_raises():
    class P:
        returncode = 0
        stdout = b""
        stderr = b""

    with patch("subprocess.run", return_value=P()):
        with pytest.raises(RuntimeError, match="산출물 없음"):
            soffice.convert_to_text(b"data", ".doc")

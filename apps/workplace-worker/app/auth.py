"""들어오는 요청을 Internal 토큰으로 검증(ai-agent internalAuth 미러)."""
import hmac
from fastapi import Header, HTTPException
from . import config


def require_internal(authorization: str = Header(default="")) -> None:
    scheme = "Internal "
    if not authorization.startswith(scheme) or not hmac.compare_digest(
            authorization[len(scheme):], config.INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")

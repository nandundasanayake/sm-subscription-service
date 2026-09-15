import os

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

load_dotenv()

# Must match the JWT_SECRET/JWT_ALGORITHM used by the service that issues tokens
# (sm-photographer-service /auth/login, sm-guest-service /guest/auth/*). This
# service only verifies tokens — it does not issue them.
JWT_SECRET = os.getenv("JWT_SECRET", "change_me_in_production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# tokenUrl is only used for OpenAPI/Swagger's "Authorize" button; the actual
# login endpoint lives on sm-photographer-service, not this service.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=True)


def decode_token(token: str = Depends(oauth2_scheme)) -> dict:
    """Decode and verify a JWT. Raises 401 if missing, expired, or invalid."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def get_current_user_id(payload: dict = Depends(decode_token)) -> str:
    """The authenticated caller's id (JWT 'sub' claim). Never trust a client-supplied user_id instead."""
    return str(payload["sub"])


def require_admin(payload: dict = Depends(decode_token)) -> dict:
    """Require the token to carry an admin claim (`is_admin: true` or `role: admin`)."""
    is_admin = payload.get("is_admin") is True or payload.get("role") in ("admin", "superadmin")
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return payload

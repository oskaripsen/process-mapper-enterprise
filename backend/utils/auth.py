"""
Simple authentication utilities for local deployment
Uses username/password with JWT tokens for session management
"""
import os
import jwt
import hashlib
from datetime import datetime, timedelta
from fastapi import HTTPException, Header, Depends
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

# Simple secret key for JWT (change this in production!)
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours


def hash_password(password: str) -> str:
    """Simple password hashing"""
    return hashlib.sha256(password.encode()).hexdigest()


def create_access_token(user_id: str, username: str) -> str:
    """Create a JWT access token"""
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "sub": user_id,
        "username": username,
        "exp": expire,
        "iat": datetime.utcnow()
    }
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def verify_token(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """
    Verify JWT token from Authorization header and return the decoded payload.
    
    Args:
        authorization: The Authorization header value (Bearer <token>)
        
    Returns:
        Dict containing the decoded JWT payload with user information
        
    Raises:
        HTTPException: If token is missing, invalid, or expired
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Missing authorization header"
        )
    
    # Extract token from "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header format. Expected 'Bearer <token>'"
        )
    
    token = parts[1]
    
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={
                "verify_exp": True,
                "verify_iat": True,
                "verify_signature": True
            }
        )
        
        if not payload.get("sub"):
            raise HTTPException(
                status_code=401,
                detail="Invalid token: missing user ID"
            )
        
        return payload
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError as e:
        logger.error(f"Invalid token: {e}")
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )
    except Exception as e:
        logger.error(f"Error verifying token: {e}")
        raise HTTPException(
            status_code=401,
            detail="Could not verify token"
        )


async def get_current_user_id(token_payload: Dict[str, Any] = Depends(verify_token)) -> str:
    """
    Extract the user ID from the verified token payload.
    
    Args:
        token_payload: The verified JWT payload from verify_token
        
    Returns:
        str: The user ID
    """
    user_id = token_payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="User ID not found in token"
        )
    return user_id


async def get_optional_user_id(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """
    Extract user ID if token is provided, otherwise return None.
    
    Args:
        authorization: Optional Authorization header value
        
    Returns:
        Optional[str]: The user ID if authenticated, None otherwise
    """
    if not authorization:
        return None
    
    try:
        token_payload = await verify_token(authorization)
        return token_payload.get("sub")
    except HTTPException:
        return None


async def get_user_organization_id(token_payload: Dict[str, Any] = Depends(verify_token)) -> Optional[str]:
    """
    Extract the organization ID from the verified token payload.
    Simplified version - returns None for single-user local deployment
    
    Args:
        token_payload: The verified JWT payload
        
    Returns:
        Optional[str]: Always None for simplified version
    """
    return None

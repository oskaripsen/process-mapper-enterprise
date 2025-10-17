"""
Role-Based Access Control (RBAC) and Permissions
Defines permission levels and authorization logic
"""
from enum import Enum
from typing import Optional, Dict, Any
from fastapi import HTTPException, Depends
import logging

from utils.auth import verify_token

logger = logging.getLogger(__name__)


class AppRole(str, Enum):
    """Global application roles"""
    SUPER_ADMIN = "super_admin"  # Full system access
    ADMIN = "admin"              # Organization admin
    MANAGER = "manager"          # Can create/edit processes
    MEMBER = "member"            # Can view and work on assigned processes
    VIEWER = "viewer"            # Read-only access


class OrgRole(str, Enum):
    """Organization-specific roles"""
    OWNER = "owner"      # Organization owner
    ADMIN = "admin"      # Organization admin
    MEMBER = "member"    # Regular member


class Permission(str, Enum):
    """Granular permissions"""
    # Process Taxonomy
    CREATE_PROCESS = "create_process"
    EDIT_PROCESS = "edit_process"
    DELETE_PROCESS = "delete_process"
    VIEW_PROCESS = "view_process"
    
    # Process Flows
    CREATE_FLOW = "create_flow"
    EDIT_FLOW = "edit_flow"
    DELETE_FLOW = "delete_flow"
    VIEW_FLOW = "view_flow"
    
    # Users & Organizations
    MANAGE_USERS = "manage_users"
    MANAGE_ORG = "manage_org"
    INVITE_USERS = "invite_users"
    
    # Assignments
    ASSIGN_USERS = "assign_users"
    VIEW_ASSIGNMENTS = "view_assignments"


# Permission matrix: which app_roles have which permissions
ROLE_PERMISSIONS = {
    AppRole.SUPER_ADMIN: [perm for perm in Permission],  # All permissions
    
    AppRole.ADMIN: [
        Permission.CREATE_PROCESS,
        Permission.EDIT_PROCESS,
        Permission.DELETE_PROCESS,
        Permission.VIEW_PROCESS,
        Permission.CREATE_FLOW,
        Permission.EDIT_FLOW,
        Permission.DELETE_FLOW,
        Permission.VIEW_FLOW,
        Permission.MANAGE_USERS,
        Permission.MANAGE_ORG,
        Permission.INVITE_USERS,
        Permission.ASSIGN_USERS,
        Permission.VIEW_ASSIGNMENTS,
    ],
    
    AppRole.MANAGER: [
        Permission.CREATE_PROCESS,
        Permission.EDIT_PROCESS,
        Permission.VIEW_PROCESS,
        Permission.CREATE_FLOW,
        Permission.EDIT_FLOW,
        Permission.VIEW_FLOW,
        Permission.ASSIGN_USERS,
        Permission.VIEW_ASSIGNMENTS,
    ],
    
    AppRole.MEMBER: [
        Permission.VIEW_PROCESS,
        Permission.CREATE_FLOW,
        Permission.EDIT_FLOW,
        Permission.VIEW_FLOW,
        Permission.VIEW_ASSIGNMENTS,
    ],
    
    AppRole.VIEWER: [
        Permission.VIEW_PROCESS,
        Permission.VIEW_FLOW,
        Permission.VIEW_ASSIGNMENTS,
    ],
}


def has_permission(app_role: str, permission: Permission) -> bool:
    """
    Check if a user with given app_role has a specific permission.
    
    Args:
        app_role: User's app role (from database)
        permission: Permission to check
        
    Returns:
        bool: True if user has permission
    """
    try:
        role = AppRole(app_role)
        return permission in ROLE_PERMISSIONS.get(role, [])
    except ValueError:
        logger.warning(f"Invalid app_role: {app_role}")
        return False


def require_permission(permission: Permission):
    """
    Decorator dependency to require a specific permission.
    
    Usage:
        @app.get("/api/process-taxonomy")
        async def get_taxonomy(
            user_id: str = Depends(require_permission(Permission.VIEW_PROCESS))
        ):
            ...
    """
    async def permission_checker(
        token_payload: Dict[str, Any] = Depends(verify_token)
    ) -> str:
        user_id = token_payload.get("sub")
        
        # TODO: Fetch user's app_role from database
        # For now, we'll need to inject user_sync_service
        # This is a simplified version
        
        # In production, you'd fetch: user = await user_sync_service.get_user(user_id)
        # Then check: if not has_permission(user['app_role'], permission):
        #     raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return user_id
    
    return permission_checker


async def check_user_permission(
    user_id: str,
    permission: Permission,
    user_sync_service
) -> bool:
    """
    Check if a user has a specific permission by looking up their role.
    
    Args:
        user_id: User ID from JWT token
        permission: Permission to check
        user_sync_service: Instance of UserSyncService
        
    Returns:
        bool: True if user has permission
    """
    user = await user_sync_service.get_user(user_id)
    if not user:
        return False
    
    app_role = user.get('app_role', 'member')
    return has_permission(app_role, permission)


async def require_app_role(
    minimum_role: AppRole,
    token_payload: Dict[str, Any],
    user_sync_service
):
    """
    Require user to have at least a certain app role.
    
    Args:
        minimum_role: Minimum required role
        token_payload: Verified JWT payload
        user_sync_service: UserSyncService instance
        
    Raises:
        HTTPException: If user doesn't have sufficient role
    """
    user_id = token_payload.get("sub")
    user = await user_sync_service.get_user(user_id)
    
    if not user:
        raise HTTPException(status_code=403, detail="User not found")
    
    user_role = user.get('app_role', 'member')
    
    # Role hierarchy (higher index = more permissions)
    role_hierarchy = [
        AppRole.VIEWER,
        AppRole.MEMBER,
        AppRole.MANAGER,
        AppRole.ADMIN,
        AppRole.SUPER_ADMIN,
    ]
    
    try:
        user_role_level = role_hierarchy.index(AppRole(user_role))
        required_level = role_hierarchy.index(minimum_role)
        
        if user_role_level < required_level:
            raise HTTPException(
                status_code=403,
                detail=f"Requires {minimum_role.value} role or higher"
            )
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid role")


def can_edit_process(user: Dict[str, Any], process_owner: str) -> bool:
    """
    Check if user can edit a specific process.
    
    Rules:
    - Super admin and admin can edit anything
    - Manager can edit anything in their org
    - Member can only edit if they created it
    - Viewer cannot edit
    
    Args:
        user: User dict from database
        process_owner: user_id of process creator
        
    Returns:
        bool: True if user can edit
    """
    app_role = user.get('app_role', 'member')
    user_id = user.get('user_id')
    
    # Admins can edit everything
    if app_role in [AppRole.SUPER_ADMIN.value, AppRole.ADMIN.value]:
        return True
    
    # Managers can edit everything in org
    if app_role == AppRole.MANAGER.value:
        return True
    
    # Members can only edit their own
    if app_role == AppRole.MEMBER.value:
        return user_id == process_owner
    
    # Viewers cannot edit
    return False


def can_delete_process(user: Dict[str, Any], process_owner: str) -> bool:
    """
    Check if user can delete a specific process.
    Similar to edit but more restrictive.
    
    Args:
        user: User dict from database
        process_owner: user_id of process creator
        
    Returns:
        bool: True if user can delete
    """
    app_role = user.get('app_role', 'member')
    user_id = user.get('user_id')
    
    # Only admins and owners can delete
    if app_role in [AppRole.SUPER_ADMIN.value, AppRole.ADMIN.value]:
        return True
    
    if user_id == process_owner:
        return True
    
    return False


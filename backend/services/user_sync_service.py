"""
User Service - Simplified user management for enterprise deployment
Handles user creation, authentication, and basic profile management
Uses SQLite for file-based storage
"""
import logging
import uuid
from typing import Optional, Dict, Any
import aiosqlite
import json

logger = logging.getLogger(__name__)


class UserSyncService:
    def __init__(self, database_path: str):
        self.database_path = database_path
        self.db: Optional[aiosqlite.Connection] = None

    async def connect(self):
        """Create database connection"""
        self.db = await aiosqlite.connect(self.database_path)
        self.db.row_factory = aiosqlite.Row  # Return rows as dict-like objects
        logger.info(f"UserSyncService connected to database: {self.database_path}")

    async def close(self):
        """Close database connection"""
        if self.db:
            await self.db.close()
            logger.info("UserSyncService disconnected from database")

    async def create_user(
        self,
        username: str,
        password_hash: str,
        email: str,
        full_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new user in the database.
        
        Args:
            username: Unique username
            password_hash: Hashed password
            email: User's email address
            full_name: User's full name (optional)
            
        Returns:
            Dict with user data
            
        Raises:
            Exception if username or email already exists
        """
        # Check if username already exists
        async with self.db.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,)
        ) as cursor:
            existing = await cursor.fetchone()
            if existing:
                raise Exception("Username already exists")
        
        # Check if email already exists
        async with self.db.execute(
            "SELECT id FROM users WHERE email = ?",
            (email,)
        ) as cursor:
            existing = await cursor.fetchone()
            if existing:
                raise Exception("Email already exists")
        
        # Create new user
        user_id = str(uuid.uuid4())
        await self.db.execute("""
            INSERT INTO users (
                id,
                username,
                password_hash,
                email,
                full_name,
                created_at,
                last_login_at
            )
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        """, (user_id, username, password_hash, email, full_name))
        
        await self.db.commit()
        
        # Fetch and return the created user
        async with self.db.execute("""
            SELECT id, username, email, full_name, created_at
            FROM users WHERE id = ?
        """, (user_id,)) as cursor:
            row = await cursor.fetchone()
            logger.info(f"Created new user: {username}")
            return dict(row)

    async def verify_user(self, username: str, password_hash: str) -> Optional[Dict[str, Any]]:
        """
        Verify user credentials.
        
        Args:
            username: Username to verify
            password_hash: Hashed password to verify
            
        Returns:
            Dict with user data if credentials are valid, None otherwise
        """
        async with self.db.execute("""
            SELECT id, username, email, full_name, created_at
            FROM users
            WHERE username = ? AND password_hash = ?
        """, (username, password_hash)) as cursor:
            row = await cursor.fetchone()
            
            if row:
                user_id = row['id']
                # Update last login time
                await self.db.execute("""
                    UPDATE users
                    SET last_login_at = datetime('now')
                    WHERE id = ?
                """, (user_id,))
                await self.db.commit()
                
                logger.info(f"User {username} logged in successfully")
                return dict(row)
            
            logger.warning(f"Failed login attempt for username: {username}")
            return None

    async def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Get user by ID.
        
        Args:
            user_id: User ID to look up
            
        Returns:
            Dict with user data if found, None otherwise
        """
        async with self.db.execute("""
            SELECT id, username, email, full_name, created_at, last_login_at
            FROM users
            WHERE id = ?
        """, (user_id,)) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None

    async def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """
        Get user by username.
        
        Args:
            username: Username to look up
            
        Returns:
            Dict with user data if found, None otherwise
        """
        async with self.db.execute("""
            SELECT id, username, email, full_name, created_at, last_login_at
            FROM users
            WHERE username = ?
        """, (username,)) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None

    async def update_user_preferences(
        self,
        user_id: str,
        preferences: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Update user preferences.
        
        Args:
            user_id: User ID
            preferences: Preferences dictionary
            
        Returns:
            Updated user data
        """
        await self.db.execute("""
            UPDATE users
            SET preferences = ?
            WHERE id = ?
        """, (json.dumps(preferences), user_id))
        
        await self.db.commit()
        
        async with self.db.execute("""
            SELECT id, username, email, full_name, preferences
            FROM users WHERE id = ?
        """, (user_id,)) as cursor:
            row = await cursor.fetchone()
            if row:
                logger.info(f"Updated preferences for user {user_id}")
                result = dict(row)
                # Parse JSON preferences
                if result.get('preferences'):
                    result['preferences'] = json.loads(result['preferences'])
                return result
            
            raise Exception("User not found")

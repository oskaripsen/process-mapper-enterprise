import aiosqlite
import json
import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from schemas.process_management import (
    ProcessTaxonomyCreate, ProcessTaxonomyUpdate, ProcessTaxonomyResponse,
    ProcessAssignmentCreate, ProcessAssignmentResponse,
    ProcessFlowCreate, ProcessFlowUpdate, ProcessFlowResponse,
    ProcessReviewCreate, ProcessReviewUpdate, ProcessReviewResponse,
    UserInvitationCreate, UserInvitationResponse,
    UserDashboardData, ProcessCompletionStats,
    ProcessTemplateResponse, ApplyTemplateRequest, TemplateSearchRequest
)
from services.process_templates import ProcessTemplatesService

class ProcessManagementService:
    def __init__(self, database_path: str):
        self.database_path = database_path
        self.db: Optional[aiosqlite.Connection] = None
        self.templates_service = ProcessTemplatesService()

    async def connect(self):
        """Initialize database connection"""
        self.db = await aiosqlite.connect(self.database_path)
        self.db.row_factory = aiosqlite.Row

    async def close(self):
        """Close database connection"""
        if self.db:
            await self.db.close()

    # Process Taxonomy Methods
    async def create_process_taxonomy(self, process_data: ProcessTaxonomyCreate, created_by: str) -> ProcessTaxonomyResponse:
        """Create a new process taxonomy item"""
        query = """
            INSERT INTO process_taxonomy (id, organization_id, parent_id, level, name, description, code, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        process_id = str(uuid.uuid4())
        parent_id = process_data.parent_id if process_data.parent_id else None
        org_id = process_data.organization_id
        
        await self.db.execute(
            query,
            (process_id, org_id, parent_id, process_data.level, process_data.name, 
             process_data.description, process_data.code, created_by)
        )
        await self.db.commit()
        
        # Fetch the created record
        async with self.db.execute("""
            SELECT id, organization_id, parent_id, level, name, description, code, is_active, created_at, updated_at, created_by
            FROM process_taxonomy WHERE id = ?
        """, (process_id,)) as cursor:
            row = await cursor.fetchone()
            result = dict(row)
            result['is_active'] = bool(result['is_active'])  # Convert INTEGER to bool
            return ProcessTaxonomyResponse(**result)

    async def get_process_taxonomy_tree(self, organization_id: Optional[str] = None) -> List[ProcessTaxonomyResponse]:
        """Get complete process taxonomy tree, optionally filtered by organization"""
        if organization_id:
            query = """
                SELECT id, organization_id, parent_id, level, name, description, code, is_active, created_at, updated_at, created_by
                FROM process_taxonomy
                WHERE organization_id = ? AND is_active = 1
                ORDER BY level, name
            """
            async with self.db.execute(query, (organization_id,)) as cursor:
                rows = await cursor.fetchall()
        else:
            query = """
                SELECT id, organization_id, parent_id, level, name, description, code, is_active, created_at, updated_at, created_by
                FROM process_taxonomy
                WHERE is_active = 1
                ORDER BY level, name
            """
            async with self.db.execute(query) as cursor:
                rows = await cursor.fetchall()
        
        # Convert to response objects
        processes = []
        for row in rows:
            row_dict = dict(row)
            row_dict['is_active'] = bool(row_dict['is_active'])
            processes.append(ProcessTaxonomyResponse(**row_dict))
        
        # Build tree structure
        process_map = {str(p.id): p for p in processes}
        root_processes = []
        
        for process in processes:
            if process.parent_id:
                parent = process_map.get(str(process.parent_id))
                if parent:
                    if not parent.children:
                        parent.children = []
                    parent.children.append(process)
            else:
                root_processes.append(process)
        
        return root_processes

    async def update_process_taxonomy(self, process_id: str, process_data: ProcessTaxonomyUpdate) -> ProcessTaxonomyResponse:
        """Update a process taxonomy item"""
        updates = []
        params = []
        
        if process_data.name is not None:
            updates.append("name = ?")
            params.append(process_data.name)
        if process_data.description is not None:
            updates.append("description = ?")
            params.append(process_data.description)
        if process_data.code is not None:
            updates.append("code = ?")
            params.append(process_data.code)
        if process_data.parent_id is not None:
            updates.append("parent_id = ?")
            params.append(process_data.parent_id)
        
        params.append(process_id)
        
        query = f"UPDATE process_taxonomy SET {', '.join(updates)} WHERE id = ?"
        await self.db.execute(query, params)
        await self.db.commit()
        
        # Fetch updated record
        async with self.db.execute("""
            SELECT id, organization_id, parent_id, level, name, description, code, is_active, created_at, updated_at, created_by
            FROM process_taxonomy WHERE id = ?
        """, (process_id,)) as cursor:
            row = await cursor.fetchone()
            result = dict(row)
            result['is_active'] = bool(result['is_active'])
            return ProcessTaxonomyResponse(**result)

    async def delete_process_taxonomy(self, process_id: str):
        """Soft delete a process taxonomy item"""
        await self.db.execute(
            "UPDATE process_taxonomy SET is_active = 0 WHERE id = ?",
            (process_id,)
        )
        await self.db.commit()

    # Process Flow Methods
    async def create_process_flow(self, flow_data: ProcessFlowCreate, created_by: str) -> ProcessFlowResponse:
        """Create a new process flow"""
        flow_id = str(uuid.uuid4())
        
        await self.db.execute("""
            INSERT INTO process_flows (id, process_id, title, description, flow_data, created_by, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (flow_id, flow_data.process_id, flow_data.title, flow_data.description, 
              json.dumps(flow_data.flow_data), created_by, 'draft'))
        
        await self.db.commit()
        
        # Fetch created record
        async with self.db.execute("""
            SELECT id, process_id, title, description, flow_data, version, is_published, status, created_by, created_at, updated_at
            FROM process_flows WHERE id = ?
        """, (flow_id,)) as cursor:
            row = await cursor.fetchone()
            result = dict(row)
            result['flow_data'] = json.loads(result['flow_data'])
            result['is_published'] = bool(result['is_published'])
            return ProcessFlowResponse(**result)

    async def get_flows_by_user(self, user_id: str) -> List[ProcessFlowResponse]:
        """Get all flows created by a user"""
        async with self.db.execute("""
            SELECT id, process_id, title, description, flow_data, version, is_published, status, created_by, created_at, updated_at
            FROM process_flows WHERE created_by = ?
            ORDER BY updated_at DESC
        """, (user_id,)) as cursor:
            rows = await cursor.fetchall()
            
            flows = []
            for row in rows:
                result = dict(row)
                result['flow_data'] = json.loads(result['flow_data'])
                result['is_published'] = bool(result['is_published'])
                flows.append(ProcessFlowResponse(**result))
            return flows

    async def get_flows_by_process(self, process_id: str) -> List[ProcessFlowResponse]:
        """Get all flows for a specific process"""
        async with self.db.execute("""
            SELECT id, process_id, title, description, flow_data, version, is_published, created_by, created_at, updated_at
            FROM process_flows WHERE process_id = ?
            ORDER BY updated_at DESC
        """, (process_id,)) as cursor:
            rows = await cursor.fetchall()
            
            flows = []
            for row in rows:
                result = dict(row)
                result['flow_data'] = json.loads(result['flow_data'])
                result['is_published'] = bool(result['is_published'])
                flows.append(ProcessFlowResponse(**result))
            return flows

    async def update_process_flow(self, flow_id: str, flow_data: ProcessFlowUpdate) -> ProcessFlowResponse:
        """Update a process flow"""
        updates = []
        params = []
        
        if flow_data.title is not None:
            updates.append("title = ?")
            params.append(flow_data.title)
        if flow_data.description is not None:
            updates.append("description = ?")
            params.append(flow_data.description)
        if flow_data.flow_data is not None:
            updates.append("flow_data = ?")
            params.append(json.dumps(flow_data.flow_data))
            # Increment version
            updates.append("version = version + 1")
        
        params.append(flow_id)
        
        query = f"UPDATE process_flows SET {', '.join(updates)} WHERE id = ?"
        await self.db.execute(query, params)
        await self.db.commit()
        
        # Fetch updated record
        async with self.db.execute("""
            SELECT id, process_id, title, description, flow_data, version, is_published, created_by, created_at, updated_at
            FROM process_flows WHERE id = ?
        """, (flow_id,)) as cursor:
            row = await cursor.fetchone()
            result = dict(row)
            result['flow_data'] = json.loads(result['flow_data'])
            result['is_published'] = bool(result['is_published'])
            return ProcessFlowResponse(**result)

    # Dashboard Methods
    async def get_dashboard_data(self, user_id: str) -> UserDashboardData:
        """Get user dashboard data"""
        # Get process assignments count
        async with self.db.execute(
            "SELECT COUNT(*) as count FROM process_assignments WHERE user_id = ?",
            (user_id,)
        ) as cursor:
            row = await cursor.fetchone()
            assigned_count = row['count'] if row else 0
        
        # Get flows created count
        async with self.db.execute(
            "SELECT COUNT(*) as count FROM process_flows WHERE created_by = ?",
            (user_id,)
        ) as cursor:
            row = await cursor.fetchone()
            flows_count = row['count'] if row else 0
        
        # Get pending reviews count
        async with self.db.execute(
            "SELECT COUNT(*) as count FROM process_reviews WHERE reviewer_id = ? AND status = 'pending'",
            (user_id,)
        ) as cursor:
            row = await cursor.fetchone()
            pending_reviews = row['count'] if row else 0
        
        return UserDashboardData(
            assigned_processes_count=assigned_count,
            completed_flows_count=flows_count,
            pending_reviews_count=pending_reviews,
            completion_stats=ProcessCompletionStats(
                completed=flows_count,
                in_progress=0,
                not_started=max(0, assigned_count - flows_count)
            )
        )

    # Template Methods
    async def get_templates_by_level(self, level: str) -> List[ProcessTemplateResponse]:
        """Get templates for a specific level"""
        return self.templates_service.get_templates_by_level(level)

    async def get_templates_by_category(self, category: str) -> List[ProcessTemplateResponse]:
        """Get templates for a specific category"""
        return self.templates_service.get_templates_by_category(category)

    async def get_template(self, template_id: str) -> Optional[ProcessTemplateResponse]:
        """Get a specific template"""
        return self.templates_service.get_template_by_id(template_id)

    async def search_templates(self, query: str) -> List[ProcessTemplateResponse]:
        """Search templates"""
        return self.templates_service.search_templates(query)

    async def apply_template(self, template_id: str, organization_id: Optional[str], created_by: str) -> List[ProcessTaxonomyResponse]:
        """Apply a template to create process taxonomy"""
        template = self.templates_service.get_template_by_id(template_id)
        if not template:
            raise ValueError(f"Template {template_id} not found")
        
        created_processes = []
        for process_data in template.processes:
            process = ProcessTaxonomyCreate(
                organization_id=organization_id,
                parent_id=None,  # Templates don't have parent relationships predefined
                level=process_data.get("level", "L1"),
                name=process_data["name"],
                description=process_data.get("description"),
                code=process_data.get("code")
            )
            created = await self.create_process_taxonomy(process, created_by)
            created_processes.append(created)
        
        return created_processes

    async def get_template_categories(self) -> List[str]:
        """Get all template categories"""
        return self.templates_service.get_categories()

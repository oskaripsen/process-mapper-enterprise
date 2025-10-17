from fastapi import FastAPI, File, UploadFile, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer, OAuth2PasswordRequestForm
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError
from typing import Optional, Dict, Any, List
import os
import json
import logging
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from services.whisper_service import WhisperService
from services.llm_service import LLMService
from services.patch_engine import PatchEngine
from services.process_management_service import ProcessManagementService
from services.user_sync_service import UserSyncService
from translators.reactflow_translator import ReactFlowTranslator
from schemas.process_flow import ProcessFlow
from schemas.process_management import (
    ProcessTaxonomyCreate, ProcessTaxonomyUpdate, ProcessTaxonomyResponse,
    ProcessAssignmentCreate, ProcessAssignmentResponse,
    ProcessFlowCreate, ProcessFlowUpdate, ProcessFlowResponse,
    ProcessReviewCreate, ProcessReviewUpdate, ProcessReviewResponse,
    UserInvitationCreate, UserInvitationResponse,
    UserDashboardData, ProcessTemplateResponse, ApplyTemplateRequest, TemplateSearchRequest
)
from utils.file_extraction import extract_text, extract_images
from utils.auth import (
    get_current_user_id, get_user_organization_id, verify_token,
    create_access_token, hash_password
)

def get_user_friendly_error(error_message: str) -> str:
    """Convert technical error messages to user-friendly ones."""
    error_lower = error_message.lower()
    
    # Validation errors
    if "must have exactly 1 incoming" in error_lower and "has 0" in error_lower:
        return "Some process steps are disconnected. Please describe the flow more clearly, explaining what happens before each step."
    
    if "must have 2–4 outgoing" in error_lower:
        return "A decision point needs at least 2 possible outcomes. Please specify what happens in each case (e.g., 'if approved' vs 'if rejected')."
    
    if "must have 2+ incoming" in error_lower:
        return "A merge point needs multiple paths leading to it. Please clarify how different paths come together."
    
    if "disconnected or invalid flows" in error_lower:
        return "The process description seems incomplete or disconnected. Please describe a complete flow from start to finish."
    
    if "no business process information" in error_lower:
        return error_message  # Already user-friendly
    
    # Default: return original with context
    return f"Flow validation failed: {error_message}. Try describing the process step-by-step in sequence."

# Load environment variables
load_dotenv()

# Initialize services
whisper_service = WhisperService()
llm_service = LLMService()
patch_engine = PatchEngine()
reactflow_translator = ReactFlowTranslator()

# Database path (SQLite file)
database_path = os.getenv("DATABASE_PATH", "process_mapper.db")
if not os.path.isabs(database_path):
    # Make path relative to backend directory
    database_path = os.path.join(os.path.dirname(__file__), database_path)

logger.info(f"Using SQLite database at: {database_path}")

process_management_service = ProcessManagementService(database_path)
user_sync_service = UserSyncService(database_path)

# Lifespan event handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database connection on startup and close on shutdown"""
    # Startup
    logger.info("Starting up AI Process Mapper API (Enterprise Edition)...")
    try:
        await process_management_service.connect()
        await user_sync_service.connect()
        logger.info("Database connections established successfully")
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("Shutting down AI Process Mapper API...")
    try:
        await process_management_service.close()
        await user_sync_service.close()
        logger.info("Database connections closed successfully")
    except Exception as e:
        logger.error(f"Error closing database connections: {e}")

app = FastAPI(
    title="AI Process Mapper Enterprise",
    version="1.0.0",
    lifespan=lifespan,
    swagger_ui_parameters={
        "persistAuthorization": True,
    }
)

# Security scheme for Swagger UI
security = HTTPBearer()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

# Configure CORS - Simplified for local use
allowed_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://localhost:8000",
]

logger.info(f"CORS enabled for origins: {allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

# Add validation error handler
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"DEBUG: Validation error for {request.url}: {exc}")
    print(f"DEBUG: Request body: {await request.body()}")
    return HTTPException(status_code=422, detail=f"Validation error: {exc}")


# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    email: str
    full_name: Optional[str] = None

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]

@app.post("/api/auth/register", response_model=AuthResponse)
async def register(data: RegisterRequest):
    """Register a new user"""
    try:
        # Hash password
        password_hash = hash_password(data.password)
        
        # Create user in database
        user = await user_sync_service.create_user(
            username=data.username,
            password_hash=password_hash,
            email=data.email,
            full_name=data.full_name
        )
        
        # Create access token
        token = create_access_token(user["id"], data.username)
        
        return AuthResponse(
            access_token=token,
            user=user
        )
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/auth/token")
async def token_login(form_data: OAuth2PasswordRequestForm = Depends()):
    """OAuth2 compatible token login for Swagger UI"""
    try:
        # Hash password
        password_hash = hash_password(form_data.password)
        
        # Verify credentials
        user = await user_sync_service.verify_user(form_data.username, password_hash)
        
        if not user:
            raise HTTPException(
                status_code=401,
                detail="Invalid username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Create access token
        token = create_access_token(user["id"], form_data.username)
        
        return {
            "access_token": token,
            "token_type": "bearer"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token login error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/auth/login", response_model=AuthResponse)
async def login(data: LoginRequest):
    """Login with username and password"""
    try:
        # Hash password
        password_hash = hash_password(data.password)
        
        # Verify credentials
        user = await user_sync_service.verify_user(data.username, password_hash)
        
        if not user:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        
        # Create access token
        token = create_access_token(user["id"], data.username)
        
        return AuthResponse(
            access_token=token,
            user=user
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail="Login failed")

@app.get("/api/users/me")
async def get_current_user(user_id: str = Depends(get_current_user_id)):
    """Get current user info"""
    try:
        user = await user_sync_service.get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user: {e}")
        raise HTTPException(status_code=500, detail="Failed to get user info")


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def reactflow_to_processflow(reactflow_data: dict) -> ProcessFlow:
    """Convert React Flow format back to ProcessFlow canonical schema."""
    from schemas.process_flow import ProcessNode, ProcessEdge, NodeType, AutomationLevel
    
    nodes = []
    for rf_node in reactflow_data.get("nodes", []):
        node_data = rf_node.get("data", rf_node)
        
        # Map React Flow node type to canonical NodeType
        node_type = NodeType.PROCESS
        rf_type = rf_node.get("type", node_data.get("type", "default"))
        if rf_type == "start":
            node_type = NodeType.START
        elif rf_type == "end":
            node_type = NodeType.END
        elif rf_type == "decision":
            node_type = NodeType.DECISION
        elif rf_type == "merge":
            node_type = NodeType.MERGE
        
        node = ProcessNode(
            id=rf_node["id"],
            type=node_type,
            label=node_data.get("label", rf_node.get("label", "Unknown")),
            owner=node_data.get("owner", rf_node.get("owner")),
            system=node_data.get("system", rf_node.get("system")),
            automation=AutomationLevel.MANUAL if node_data.get("manualOrAutomated", rf_node.get("manualOrAutomated")) == "manual" else AutomationLevel.AUTOMATED,
            logical_id=node_data.get("logical_id", rf_node.get("logical_id")),
            user_modified=node_data.get("user_modified", rf_node.get("user_modified", False))
        )
        nodes.append(node)
    
    edges = []
    for rf_edge in reactflow_data.get("edges", []):
        edge = ProcessEdge(
            id=rf_edge.get("id", f"edge-{rf_edge['source']}-{rf_edge['target']}"),
            source=rf_edge["source"],
            target=rf_edge["target"],
            condition=rf_edge.get("condition") or rf_edge.get("label")
        )
        edges.append(edge)
    
    flow = ProcessFlow(nodes=nodes, edges=edges)
    return flow


# ============================================================================
# CORE PROCESS MAPPING ENDPOINTS
# ============================================================================

class TranscriptRequest(BaseModel):
    transcript: str
    context: str = ""
    existingFlow: Optional[dict] = None

class IncrementalFlowRequest(BaseModel):
    transcript: str
    accumulatedTranscript: str
    existingFlow: dict
    sessionId: int
    clarification: Optional[Dict] = None  # Add clarification context

class ClarificationRequest(BaseModel):
    transcript: str
    accumulatedTranscript: Optional[str] = ""
    existingFlow: Optional[dict] = None

@app.get("/")
async def root():
    return {"message": "AI Process Mapper API - Enterprise Edition"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id)
):
    """Transcribe audio file to text using Whisper"""
    try:
        logger.info(f"Received transcription request from user {user_id}")
        logger.info(f"File: {file.filename}, Content-Type: {file.content_type}")
        
        # Read file content
        file_content = await file.read()
        logger.info(f"File size: {len(file_content)} bytes")
        
        if not file_content:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
        
        # Transcribe using Whisper
        transcript = await whisper_service.transcribe_audio_from_bytes(file_content, file.filename)
        
        logger.info(f"Transcription successful: {len(transcript)} characters")
        return {"transcript": transcript}
        
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

@app.post("/generate-flow")
async def generate_flow(
    request: TranscriptRequest,
    user_id: str = Depends(get_current_user_id)
):
    """Generate process flow from transcript"""
    try:
        logger.info(f"Generating flow from transcript for user {user_id}")
        
        # Generate structured data using LLM
        if request.existingFlow:
            existing_flow = reactflow_to_processflow(request.existingFlow)
            process_flow = await llm_service.generate_process_from_transcript(
                request.transcript, 
                request.context,
                existing_flow=existing_flow
            )
        else:
            process_flow = await llm_service.generate_process_from_transcript(
                request.transcript, 
                request.context
            )
        
        # Convert to React Flow format
        reactflow_data = reactflow_translator.translate(process_flow)
        
        logger.info("Flow generation successful")
        return reactflow_data
        
    except ValueError as e:
        user_friendly_error = get_user_friendly_error(str(e))
        logger.warning(f"Validation error in flow generation: {e}")
        raise HTTPException(status_code=400, detail=user_friendly_error)
    except Exception as e:
        logger.error(f"Error generating flow: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Flow generation failed: {str(e)}")

@app.post("/clarify-process-intent")
async def clarify_process_intent(
    request: ClarificationRequest,
    user_id: str = Depends(get_current_user_id)
):
    """Clarify and summarize what the user described before generating flow"""
    try:
        logger.info(f"Clarifying process intent for user {user_id}")
        
        # Convert ReactFlow format to ProcessFlow format if needed
        existing_flow = None
        if request.existingFlow and request.existingFlow.get("nodes"):
            try:
                existing_flow = reactflow_to_processflow(request.existingFlow)
                logger.info(f"Converted existing flow: {len(existing_flow.nodes)} nodes, {len(existing_flow.edges)} edges")
            except Exception as conv_error:
                logger.warning(f"Could not convert existing flow: {str(conv_error)}")
        
        # Use LLM to clarify the intent
        clarification = await llm_service.clarify_process_intent(
            transcript=request.transcript,
            context=request.accumulatedTranscript,
            existing_flow=existing_flow
        )
        
        if not clarification:
            raise HTTPException(status_code=400, detail="Could not understand the process description")
        
        logger.info(f"Process clarification successful: {len(clarification.get('steps', []))} steps identified")
        return clarification
        
    except ValueError as e:
        user_friendly_error = get_user_friendly_error(str(e))
        logger.warning(f"Validation error in clarification: {e}")
        raise HTTPException(status_code=400, detail=user_friendly_error)
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        logger.error(f"Error in process clarification: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Clarification failed: {str(e)}")

@app.post("/generate-incremental-flow")
async def generate_incremental_flow(
    request: IncrementalFlowRequest,
    user_id: str = Depends(get_current_user_id)
):
    """Generate incremental updates to existing flow"""
    try:
        logger.info(f"Generating incremental flow update for user {user_id}")
        
        # Convert ReactFlow format to ProcessFlow format
        try:
            existing_flow = reactflow_to_processflow(request.existingFlow)
            logger.info(f"Converted existing flow: {len(existing_flow.nodes)} nodes, {len(existing_flow.edges)} edges")
        except Exception as conv_error:
            logger.error(f"Error converting ReactFlow to ProcessFlow: {str(conv_error)}")
            raise HTTPException(status_code=400, detail=f"Invalid flow format: {str(conv_error)}")
        
        # Step 1: Generate flow patch from LLM using the new transcript
        # Use accumulated transcript as the main input and new transcript as context
        flow_patch = await llm_service.generate_flow_patch(
            transcript=request.transcript,
            context=request.accumulatedTranscript,
            existing_flow=existing_flow
        )
        
        if not flow_patch:
            logger.warning("LLM returned no patch (likely meaningless input)")
            # Return the existing flow unchanged
            reactflow_data = reactflow_translator.translate(existing_flow)
            return reactflow_data
        
        # Step 2: Apply the patch to the existing flow
        updated_flow = patch_engine.apply_patch(existing_flow, flow_patch)
        
        # Step 3: Convert back to ReactFlow format
        reactflow_data = reactflow_translator.translate(updated_flow)
        
        logger.info(f"Incremental flow generation successful: {len(updated_flow.nodes)} nodes, {len(updated_flow.edges)} edges")
        return reactflow_data
        
    except ValueError as e:
        user_friendly_error = get_user_friendly_error(str(e))
        logger.warning(f"Validation error in incremental flow: {e}")
        raise HTTPException(status_code=400, detail=user_friendly_error)
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        logger.error(f"Error in incremental flow generation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Incremental update failed: {str(e)}")

@app.post("/upload-doc")
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id)
):
    """Upload and process document to extract process text"""
    try:
        logger.info(f"Received document upload from user {user_id}: {file.filename}")
        
        # Extract text from document
        extracted_text = await extract_text(file)
        
        if not extracted_text:
            raise HTTPException(
                status_code=400,
                detail="No text could be extracted from the document"
            )
        
        # Reset file pointer for image extraction
        await file.seek(0)
        
        # Extract images if any
        images = await extract_images(file)
        
        logger.info(f"Document processing successful: {len(extracted_text)} characters extracted")
        
        # Generate process flow from extracted text
        logger.info("Generating process flow from extracted text...")
        
        # Step 1: Extract process intent from text using LLM
        process_intent = await llm_service.extract_process_intent(
            transcript=extracted_text,
            context=None
        )
        
        if not process_intent:
            raise HTTPException(
                status_code=400,
                detail="Could not extract process information from the document"
            )
        
        # Step 2: Translate intent to flow patch
        from services.intent_translator import IntentTranslator
        intent_translator = IntentTranslator()
        flow_patch = intent_translator.translate_intent_to_flow_patch(
            intent=process_intent,
            existing_flow=None
        )
        
        # Step 3: Apply patch to create a new ProcessFlow
        empty_flow = ProcessFlow(nodes=[], edges=[])
        process_flow = patch_engine.apply_patch(empty_flow, flow_patch)
        
        # Step 4: Convert to React Flow format
        reactflow_data = reactflow_translator.translate(process_flow)
        
        logger.info("Flow generation successful")
        
        # Return flow data with metadata
        return {
            **reactflow_data,
            "extracted_text": extracted_text,
            "images": images,
            "filename": file.filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing document: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Document processing failed: {str(e)}")


# ============================================================================
# PROCESS MANAGEMENT ENDPOINTS
# ============================================================================

@app.post("/api/process-taxonomy", response_model=ProcessTaxonomyResponse)
async def create_process_taxonomy(
    process_data: ProcessTaxonomyCreate,
    user_id: str = Depends(get_current_user_id)
):
    """Create a new process taxonomy item"""
    try:
        result = await process_management_service.create_process_taxonomy(process_data, user_id)
        return result
    except Exception as e:
        logger.error(f"Error creating process taxonomy: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/process-taxonomy", response_model=List[ProcessTaxonomyResponse])
async def get_process_taxonomy(user_id: str = Depends(get_current_user_id)):
    """Get complete process taxonomy tree"""
    try:
        result = await process_management_service.get_process_taxonomy_tree(organization_id=None)
        return result
    except Exception as e:
        logger.error(f"Error getting process taxonomy: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/process-taxonomy/{process_id}", response_model=ProcessTaxonomyResponse)
async def update_process_taxonomy(
    process_id: str,
    process_data: ProcessTaxonomyUpdate,
    user_id: str = Depends(get_current_user_id)
):
    """Update a process taxonomy item"""
    try:
        result = await process_management_service.update_process_taxonomy(process_id, process_data)
        return result
    except Exception as e:
        logger.error(f"Error updating process taxonomy: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/process-taxonomy/{process_id}")
async def delete_process_taxonomy(
    process_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """Soft delete a process taxonomy item"""
    try:
        await process_management_service.delete_process_taxonomy(process_id)
        return {"message": "Process taxonomy deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting process taxonomy: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/process-flows", response_model=ProcessFlowResponse)
async def create_process_flow(
    flow_data: ProcessFlowCreate,
    user_id: str = Depends(get_current_user_id)
):
    """Create a new process flow"""
    try:
        result = await process_management_service.create_process_flow(flow_data, user_id)
        return result
    except Exception as e:
        logger.error(f"Error creating process flow: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/process-flows/user/{user_id_param}", response_model=List[ProcessFlowResponse])
async def get_user_flows(
    user_id_param: str,
    user_id: str = Depends(get_current_user_id)
):
    """Get all flows for a user"""
    try:
        result = await process_management_service.get_flows_by_user(user_id_param)
        return result
    except Exception as e:
        logger.error(f"Error getting user flows: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/process-flows/process/{process_id}", response_model=List[ProcessFlowResponse])
async def get_process_flows(
    process_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """Get all flows for a process"""
    try:
        result = await process_management_service.get_flows_by_process(process_id)
        return result
    except Exception as e:
        logger.error(f"Error getting process flows: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/process-flows/{flow_id}", response_model=ProcessFlowResponse)
async def update_process_flow(
    flow_id: str,
    flow_data: ProcessFlowUpdate,
    user_id: str = Depends(get_current_user_id)
):
    """Update a process flow"""
    try:
        result = await process_management_service.update_process_flow(flow_id, flow_data)
        return result
    except Exception as e:
        logger.error(f"Error updating process flow: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dashboard/{user_id_param}", response_model=UserDashboardData)
async def get_dashboard(
    user_id_param: str,
    user_id: str = Depends(get_current_user_id)
):
    """Get user dashboard data"""
    try:
        result = await process_management_service.get_dashboard_data(user_id_param)
        return result
    except Exception as e:
        logger.error(f"Error getting dashboard data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/templates/level/{level}", response_model=List[ProcessTemplateResponse])
async def get_templates_by_level(level: str):
    """Get templates for a specific level"""
    try:
        result = await process_management_service.get_templates_by_level(level)
        return result
    except Exception as e:
        logger.error(f"Error getting templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/templates/category/{category}", response_model=List[ProcessTemplateResponse])
async def get_templates_by_category(category: str):
    """Get templates for a specific category"""
    try:
        result = await process_management_service.get_templates_by_category(category)
        return result
    except Exception as e:
        logger.error(f"Error getting templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/templates/{template_id}", response_model=ProcessTemplateResponse)
async def get_template(template_id: str):
    """Get a specific template"""
    try:
        result = await process_management_service.get_template(template_id)
        if not result:
            raise HTTPException(status_code=404, detail="Template not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting template: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/templates/search", response_model=List[ProcessTemplateResponse])
async def search_templates(search_request: TemplateSearchRequest):
    """Search templates"""
    try:
        result = await process_management_service.search_templates(search_request.query)
        return result
    except Exception as e:
        logger.error(f"Error searching templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/templates/apply", response_model=List[ProcessTaxonomyResponse])
async def apply_template(
    apply_request: ApplyTemplateRequest,
    user_id: str = Depends(get_current_user_id)
):
    """Apply a template to create process taxonomy"""
    try:
        result = await process_management_service.apply_template(
            apply_request.template_id,
            apply_request.organization_id,
            user_id
        )
        return result
    except Exception as e:
        logger.error(f"Error applying template: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/templates/categories", response_model=List[str])
async def get_template_categories():
    """Get all template categories"""
    try:
        result = await process_management_service.get_template_categories()
        return result
    except Exception as e:
        logger.error(f"Error getting template categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)


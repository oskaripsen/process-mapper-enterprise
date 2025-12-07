# AI Process Mapper - Enterprise Edition

A simplified, self-contained version of the AI Process Mapper designed for enterprise deployment on a single laptop. This version removes external authentication dependencies and uses local PostgreSQL for data storage.

## Features

- 🎤 **Audio Upload**: Upload audio files describing your process
- 🧠 **AI Transcription**: Uses OpenAI Whisper for speech-to-text conversion
- 🤖 **Process Extraction**: Uses GPT-4o-mini to extract process steps and create structured flow data
- 📊 **Interactive Flowchart**: Renders process flows using React Flow with drag-and-drop editing
- 📁 **Export Options**: Download flow as JSON or export as PNG image
- 🔐 **Simple Authentication**: Username/password authentication without external dependencies
- 💾 **Local Database**: PostgreSQL database for complete data control

## Key Differences from MVP

- ✅ **Simple Authentication**: Local username/password authentication with JWT tokens
- ✅ **No Landing Page**: Direct access to the application
- ✅ **Local PostgreSQL**: Full control over data storage
- ✅ **Simplified Dependencies**: Removed external service dependencies
- ✅ **No BPMN/Mermaid Translators**: Focused on ReactFlow format only

## Prerequisites

Before you begin, ensure you have the following installed:

- **Python 3.11** (required for FastAPI/Pydantic compatibility)
- **Node.js 16+** and npm
- **OpenAI API key** (for Whisper and GPT features)

**Note:** No database installation required! This version uses SQLite, which is included with Python.

## Quick Start

### 1. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Initialize the SQLite database
python init_db.py

# Create .env file from example
cp env.example .env

# Edit .env file with your settings
# - Add your OpenAI API key
# - Set a secure JWT secret key
nano .env  # or use your preferred editor

# Run the backend server
python app.py
```

The backend will be available at `http://localhost:8000`

### 2. Frontend Setup

```bash
# Navigate to frontend directory (in a new terminal)
cd frontend

# Install dependencies
npm install

# Create .env file from example (optional - defaults to localhost:8000)
cp env.example .env

# Start the development server
npm run dev
```

The frontend will be available at `http://localhost:5173`

### 3. Create Your First User

1. Open your browser and go to `http://localhost:5173`
2. Click "Register" on the login page
3. Fill in your username, email, and password
4. Click "Create Account"

You're now ready to start mapping processes!

## Configuration

### Backend Configuration (.env)

```env
# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Database Configuration (SQLite - file-based, no installation needed!)
DATABASE_PATH=process_mapper.db

# JWT Authentication
JWT_SECRET_KEY=your-secure-random-string-here

# Server Configuration
PORT=8000
```

### Frontend Configuration (.env)

```env
# API Configuration
VITE_API_BASE_URL=http://localhost:8000
```

## Database Schema

The application uses SQLite with the following main tables:

- **users**: User accounts and authentication
- **process_taxonomy**: Hierarchical process structure (L1, L2, L3 levels)
- **process_flows**: Workflow diagrams and flow data
- **process_assignments**: User assignments to processes
- **process_reviews**: Review and approval workflow

The database is stored as a single `.db` file. See `backend/schema.sql` for complete schema definition.

## Usage

### Creating Processes

1. **Navigate to Overview Tab**: View and manage your process hierarchy
2. **Create Process Levels**: Build your L1, L2, L3 process taxonomy
3. **Navigate to Design Tab**: Start designing workflows

### Designing Workflows

1. **Select a Process**: Choose which process to map
2. **Choose Input Method**:
   - **Voice Recording**: Record audio description of your process
   - **Audio Upload**: Upload a pre-recorded audio file
   - **Document Upload**: Upload process documents (PDF, DOCX, PPTX)
   - **Free Design**: Start with a blank canvas

3. **Generate Flow**: Let AI create the workflow diagram
4. **Edit and Refine**: Drag nodes, add connections, edit labels
5. **Save**: Store your workflow in the database

### Exporting Workflows

- **Download JSON**: Export flow data for backup or sharing
- **Export PNG**: Save workflow as an image

## Project Structure

```
mvp-enterprise/
├── backend/
│   ├── app.py                 # Main FastAPI application
│   ├── requirements.txt       # Python dependencies
│   ├── schema.sql            # Database schema
│   ├── env.example           # Environment variables template
│   ├── schemas/              # Data models
│   ├── services/             # Business logic
│   ├── translators/          # Format converters (ReactFlow only)
│   └── utils/                # Utilities (simplified auth)
└── frontend/
    ├── package.json          # Node.js dependencies
    ├── vite.config.js        # Vite configuration
    ├── env.example          # Environment variables template
    └── src/
        ├── main.jsx          # React entry point
        ├── App.jsx           # Main app with local authentication
        ├── config/
        │   └── api.js        # API config (simple auth)
        └── components/
            ├── Login.jsx               # Login/Register component
            ├── UnifiedWorkflowCanvas.jsx
            ├── ProcessTaxonomy.jsx
            └── ...
```

## Development

### Backend Development

- API documentation available at `http://localhost:8000/docs` (Swagger UI)
- Logs are written to console
- Hot reload: Backend must be restarted manually

### Frontend Development

- Hot reload enabled by Vite
- React DevTools compatible
- Component-based architecture

## Security Notes

⚠️ **Important for Production Deployment**:

1. **Change JWT Secret**: Use a strong, random secret key for JWT_SECRET_KEY
2. **Use Strong Passwords**: The authentication is simple - encourage strong passwords
3. **HTTPS**: Deploy behind HTTPS in production
4. **Database Security**: Protect the `.db` file with appropriate file permissions
5. **Backup Regularly**: Backup the `.db` file regularly (it's just a single file!)
6. **Update Dependencies**: Keep all packages up to date

## Troubleshooting

### Database Issues

```bash
# Reinitialize database if needed
cd backend
python init_db.py

# Check if database file exists
ls -lh process_mapper.db
```

### Backend Won't Start

- Verify Python version: `python --version` (should be 3.11)
- Check virtual environment is activated
- Verify DATABASE_PATH in .env is correct
- Ensure database is initialized with `python init_db.py`
- Check OpenAI API key is set
- Review logs for specific error messages

### Frontend Won't Start

- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check if port 5173 is available
- Verify API_BASE_URL in .env (or uses default)

### Authentication Issues

- Clear browser localStorage: `localStorage.clear()` in browser console
- Check JWT_SECRET_KEY is set in backend .env
- Verify backend is running and accessible

### OpenAI API Errors

- Verify API key is correct and active
- Check API usage limits and billing
- Review error messages in backend logs

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/users/me` - Get current user

### Process Mapping
- `POST /transcribe` - Transcribe audio to text
- `POST /generate-flow` - Generate process flow from transcript
- `POST /upload-doc` - Upload and process documents

### Process Management
- `GET /api/process-taxonomy` - Get process hierarchy
- `POST /api/process-taxonomy` - Create process
- `PUT /api/process-taxonomy/{id}` - Update process
- `DELETE /api/process-taxonomy/{id}` - Delete process

### Flow Management
- `POST /api/process-flows` - Create flow
- `GET /api/process-flows/user/{id}` - Get user's flows
- `PUT /api/process-flows/{id}` - Update flow

See `backend/app.py` for complete API documentation.

## License

MIT

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review backend logs for errors
3. Check browser console for frontend errors
4. Verify all prerequisites are installed correctly


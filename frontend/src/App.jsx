import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import EnhancedProcessSelector from './components/EnhancedProcessSelector';
import UnifiedWorkflowCanvas from './components/UnifiedWorkflowCanvas';
import ProcessTaxonomy from './components/ProcessTaxonomy';
import { API_BASE_URL, authenticatedFetch, isAuthenticated, getCurrentUser, clearAuthToken } from './config/api';

function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  const [currentUser, setCurrentUser] = useState(getCurrentUser());
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [workflowType, setWorkflowType] = useState(null); // 'live', 'upload', 'document'
  const [flowData, setFlowData] = useState(null);
  const [currentView, setCurrentView] = useState('taxonomy'); // 'taxonomy', 'workflow'
  const [selectedProcessForWorkflow, setSelectedProcessForWorkflow] = useState(null); // {id, name}
  const [selectedFlowForWorkflow, setSelectedFlowForWorkflow] = useState(null); // flow object for editing
  const [showL3ProcessSelector, setShowL3ProcessSelector] = useState(false);

  // Auto-dismiss success messages after 2 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess('');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const handleLoginSuccess = (user) => {
    setAuthenticated(true);
    setCurrentUser(user);
  };

  const handleLogout = () => {
    clearAuthToken();
    setAuthenticated(false);
    setCurrentUser(null);
  };

  const handleTranscriptionComplete = (transcriptText) => {
    setTranscript(transcriptText);
    setError('');
    setSuccess('Audio transcribed successfully! You can now generate the process flow.');
  };

  const handleFlowGenerated = (data) => {
    setFlowData(data);
    setError('');
    setSuccess('Process flow generated successfully from your documents!');
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setSuccess('');
  };

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleWorkflowSelect = (type) => {
    setWorkflowType(type);
    setError('');
    setSuccess('');
    setFlowData(null);
  };

  const handleNavigateToWorkflow = (processId, processName, flow = null) => {
    setSelectedProcessForWorkflow({ id: processId, name: processName });
    setSelectedFlowForWorkflow(flow);
    setCurrentView('workflow');
    if (flow) {
      // If editing an existing flow, go directly to the appropriate workflow type
      setWorkflowType('existing');
    } else {
      setWorkflowType(null); // Reset workflow type to show selection
    }
  };

  const handleSelectL3Process = (process) => {
    setSelectedProcessForWorkflow({ id: process.id, name: process.name });
    setShowL3ProcessSelector(false);
  };

  const handleSaveFlow = async (flowData, processId, processName) => {
    try {
      // If editing an existing flow, update it
      if (selectedFlowForWorkflow) {
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows/${selectedFlowForWorkflow.id}`,
          {
            method: 'PUT',
            body: {
              title: selectedFlowForWorkflow.title,
              description: selectedFlowForWorkflow.description,
              flow_data: flowData
            }
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to update flow');
        }
        
        setSuccess('Process flow updated successfully!');
      } else {
        // Create new flow
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows`,
          {
            method: 'POST',
            body: {
              process_id: processId,
              title: `${processName} Flow`,
              description: `Process flow for ${processName}`,
              flow_data: flowData
            }
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to create flow');
        }
        
        setSuccess('Process flow saved successfully!');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleWorkflowTypeSelect = (type) => {
    if (type === 'existing' || type === 'free') {
      if (!selectedProcessForWorkflow) {
        setShowL3ProcessSelector(true);
        return;
      }
    }
    setWorkflowType(type);
  };

  // Show login if not authenticated
  if (!authenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app">
      <div className="header">
        <div className="header-content">
          <div className="header-left">
            <h1>AI Process Mapper</h1>
          </div>
          <div className="header-right">
            <span style={{ marginRight: '16px', color: '#666' }}>
              {currentUser?.username || currentUser?.email}
            </span>
            <button 
              onClick={handleLogout}
              style={{
                padding: '8px 16px',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="navigation">
        <div className="nav-tabs">
          <button 
            className={`nav-tab ${currentView === 'taxonomy' ? 'active' : ''}`}
            onClick={() => setCurrentView('taxonomy')}
          >
            Overview
          </button>
          <button 
            className={`nav-tab ${currentView === 'workflow' ? 'active' : ''}`}
            onClick={() => setCurrentView('workflow')}
          >
            Design
          </button>
        </div>
      </div>

      <div className="main-content">
        {/* Process Overview View */}
        {currentView === 'taxonomy' && <ProcessTaxonomy onNavigateToWorkflow={handleNavigateToWorkflow} currentUser={currentUser} />}

        {/* Workflow Creation View */}
        {currentView === 'workflow' && (
          <>
            {selectedProcessForWorkflow ? (
              /* Unified Canvas - Show when process is selected */
              <UnifiedWorkflowCanvas 
                key={selectedProcessForWorkflow.id} // Force remount when process changes
                selectedProcess={selectedProcessForWorkflow}
                onChangeProcess={() => {
                  // Just open the modal without clearing the current process
                  setShowL3ProcessSelector(true);
                }}
                onError={handleError}
                onSuccess={(msg) => setSuccess(msg)}
              />
            ) : (
              /* No process selected - Show selection prompt */
              <div className="workflow-empty-state">
                <div className="empty-state-content">
                  <h2>Design Your Process Flow</h2>
                  <p>Select a process to start designing your workflow</p>
                  <button 
                    className="btn btn-primary btn-large"
                    onClick={() => setShowL3ProcessSelector(true)}
                  >
                    Select Process
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Enhanced Process Selector Modal */}
        <EnhancedProcessSelector
          isOpen={showL3ProcessSelector}
          onClose={() => setShowL3ProcessSelector(false)}
          onSelectProcess={handleSelectL3Process}
        />
      </div>

      {/* Error and Success Messages - Outside main-content for visibility */}
      {error && (
        <div className="error" onClick={clearMessages}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {success && (
        <div className="success" onClick={clearMessages}>
          <strong>Success:</strong> {success}
        </div>
      )}
    </div>
  );
}

export default App;


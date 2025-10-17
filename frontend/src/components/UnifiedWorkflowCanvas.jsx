import React, { useState, useRef } from 'react';
import { API_BASE_URL, authenticatedFetch } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import FlowChart from './FlowChart';
import FileUpload from './FileUpload';
import DocumentUpload from './DocumentUpload';

const UnifiedWorkflowCanvas = ({ 
  selectedProcess,
  onChangeProcess,
  onError,
  onSuccess 
}) => {
  const { getToken } = useAuth();
  const [transcript, setTranscript] = useState('');
  const [flowData, setFlowData] = useState(null);
  const [activeInputMethod, setActiveInputMethod] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  
  // Write mode state
  const [isWriteMode, setIsWriteMode] = useState(false);
  const [writeMessage, setWriteMessage] = useState('');
  const [accumulatedWriteTranscript, setAccumulatedWriteTranscript] = useState('');
  const [chatHistory, setChatHistory] = useState([]); // Array of {role: 'user' | 'assistant', content: string}
  const [pendingClarification, setPendingClarification] = useState(null); // Store the clarification response
  const [isClarificationMode, setIsClarificationMode] = useState(false); // Track if we're waiting for user confirmation
  const [isChatMinimized, setIsChatMinimized] = useState(false); // Track if chat is minimized (hidden)
  
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);
  const audioChunksRef = useRef([]);
  const flowDataRef = useRef(null); // Track latest flow data for incremental updates
  const [currentFlowId, setCurrentFlowId] = useState(null); // Track the current flow ID for updates

  // Load saved flow data when process changes
  React.useEffect(() => {
    const loadSavedFlow = async () => {
      if (selectedProcess?.id) {
        console.log('📥 Loading saved flow for process:', selectedProcess.id);
        try {
          const response = await authenticatedFetch(`${API_BASE_URL}/api/process-flows/process/${selectedProcess.id}`);
          if (!response.ok) {
            throw new Error('Failed to load process flows');
          }
          const data = await response.json();
          if (data && data.length > 0) {
            // Get the most recent flow (first in the list)
            const latestFlow = data[0];
            console.log('✅ Loaded flow with', latestFlow.flow_data?.nodes?.length || 0, 'nodes');
            setFlowData(latestFlow.flow_data);
            setCurrentFlowId(latestFlow.id); // Store flow ID for updates
            flowDataRef.current = latestFlow.flow_data; // Initialize ref
            onSuccess?.('Loaded saved flow data');
          } else {
            console.log('ℹ️ No saved flow found for this process');
            // Reset flow data if no saved flow exists
            setFlowData(null);
            setCurrentFlowId(null); // Reset flow ID
            flowDataRef.current = null;
          }
        } catch (error) {
          console.error('Error loading saved flow:', error);
          // Fallback to localStorage for now
          try {
            const savedData = localStorage.getItem(`flow_${selectedProcess.id}`);
            if (savedData) {
              const parsed = JSON.parse(savedData);
              if (parsed.flowData) {
                setFlowData(parsed.flowData);
                flowDataRef.current = parsed.flowData; // Initialize ref
                if (parsed.transcript) {
                  setTranscript(parsed.transcript);
                }
                onSuccess?.('Loaded saved flow data from cache');
              }
            }
          } catch (localError) {
            console.error('Error loading from localStorage:', localError);
          }
        }
      }
    };
    
    loadSavedFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProcess?.id]); // Only re-run when process ID changes

  const handleTranscriptionComplete = (text) => {
    setTranscript(text);
    setActiveInputMethod(null);
    setIsProcessing(false);
    onSuccess?.('Audio transcribed successfully');
  };

  const handleFlowGenerated = (data, inputMethod = 'document') => {
    console.log('📊 Flow data received in UnifiedWorkflowCanvas:', data);
    console.log('  - Has nodes?', !!data?.nodes);
    console.log('  - Has edges?', !!data?.edges);
    console.log('  - Node count:', data?.nodes?.length);
    console.log('  - Edge count:', data?.edges?.length);
    setFlowData(data);
    flowDataRef.current = data; // Update ref immediately for next incremental call
    setActiveInputMethod(inputMethod); // Set to the appropriate input method
    setIsProcessing(false);
    setProcessingMessage('');
    if (inputMethod === 'voice') {
      onSuccess?.('Flow updated from voice input');
    } else {
      onSuccess?.(`Flow generated successfully! (${data?.nodes?.length || 0} steps)`);
    }
  };

  // Handle saving flow when user clicks save button
  const handleSaveFlow = async (flowDataToSave) => {
    try {
      console.log('💾 Saving flow for process:', selectedProcess.id);
      console.log('  - Current flow ID:', currentFlowId);
      console.log('  - Nodes to save:', flowDataToSave?.nodes?.length);
      
      if (currentFlowId) {
        // Update existing flow
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows/${currentFlowId}`,
          {
            method: 'PUT',
            body: {
              flow_data: flowDataToSave
            }
          },
          getToken
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to update flow');
        }
        
        console.log('✅ Flow updated successfully');
        setFlowData(flowDataToSave); // Update local state
        flowDataRef.current = flowDataToSave;
        onSuccess?.('Process flow updated successfully!');
      } else {
        // Create new flow
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows`,
          {
            method: 'POST',
            body: {
              process_id: selectedProcess.id,
              title: `${selectedProcess.name} - Process Flow`,
              description: `Process flow for ${selectedProcess.name}`,
              flow_data: flowDataToSave
            }
          },
          getToken
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to create flow');
        }
        
        const data = await response.json();
        console.log('✅ Flow created successfully with ID:', data.id);
        setCurrentFlowId(data.id); // Store the new flow ID
        setFlowData(flowDataToSave); // Update local state
        flowDataRef.current = flowDataToSave;
        onSuccess?.('Process flow saved successfully!');
      }
      
      // Also save to localStorage as backup
      const saveData = {
        processId: selectedProcess.id,
        processName: selectedProcess.name,
        flowData: flowDataToSave,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(`flow_${selectedProcess.id}`, JSON.stringify(saveData));
    } catch (error) {
      console.error('❌ Error saving flow:', error);
      onError?.('Failed to save flow: ' + (error.message || 'Unknown error'));
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Use audio/webm with opus codec for better compatibility
      const options = { mimeType: 'audio/webm;codecs=opus' };
      const recorder = new MediaRecorder(stream, options);
      
      audioChunksRef.current = [];
      
      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          console.log('Audio chunk available:', event.data.size, 'bytes');
          // Accumulate chunks to ensure we have complete audio data
          audioChunksRef.current.push(event.data);
          
          // Create a complete audio blob from all chunks so far
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
          console.log('Accumulated audio blob:', audioBlob.size, 'bytes');
          await handleAudioChunk(audioBlob);
        }
      };
      
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        setIsProcessing(false);
      };
      
      // Start recording with 15-second chunks
      recorder.start(15000); // Send a chunk every 15 seconds
      setMediaRecorder(recorder);
      setIsRecording(true);
      setActiveInputMethod('voice');
      onSuccess?.('Live recording started...');
    } catch (error) {
      console.error('Error starting recording:', error);
      onError('Failed to start recording. Please check microphone permissions.');
    }
  };

  const handlePauseRecording = () => {
    if (mediaRecorder && isRecording) {
      if (isPaused) {
        // Resume recording - will start sending chunks again
        mediaRecorder.resume();
        setIsPaused(false);
        setIsProcessing(false);
        onSuccess?.('Recording resumed - sending audio chunks every 15 seconds');
      } else {
        // Pause recording - stops sending chunks
        mediaRecorder.pause();
        setIsPaused(true);
        setIsProcessing(false);
        onSuccess?.('Recording paused - audio chunks stopped');
      }
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setIsPaused(false);
      setIsProcessing(true);
      setProcessingMessage('Transcribing audio...');
    }
  };

  const handleAudioChunk = async (audioBlob) => {
    try {
      setIsProcessing(true);
      setProcessingMessage('Transcribing and generating flow...');
      
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');
      
      const response = await authenticatedFetch(`${API_BASE_URL}/transcribe`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      
      if (data.transcript) {
        // Append new transcript to existing one (hidden from UI)
        const newChunk = data.transcript;
        const updatedTranscript = transcript ? `${transcript} ${newChunk}` : newChunk;
        setTranscript(updatedTranscript);
        console.log('Updated transcript:', updatedTranscript);
        
        // Automatically generate/update flow from the transcript incrementally
        setProcessingMessage('Updating process flow...');
        const currentFlow = flowDataRef.current || { nodes: [], edges: [] };
        console.log('📤 Sending incremental flow request with existing flow:', {
          existingNodeCount: currentFlow.nodes?.length || 0,
          existingEdgeCount: currentFlow.edges?.length || 0
        });
        const incrementalResponse = await authenticatedFetch(`${API_BASE_URL}/generate-incremental-flow`, {
          method: 'POST',
          body: {
            transcript: newChunk,
            accumulatedTranscript: updatedTranscript,
            existingFlow: currentFlow,
            sessionId: Date.now()
          }
        });

        if (!incrementalResponse.ok) {
          throw new Error('Flow generation failed');
        }

        const incrementalData = await incrementalResponse.json();
        
        if (incrementalData && incrementalData.nodes) {
          console.log('🎤 Flow updated incrementally from audio chunk:', {
            nodeCount: incrementalData.nodes.length,
            edgeCount: incrementalData.edges?.length,
            nodes: incrementalData.nodes.map(n => ({ id: n.id, type: n.type, label: n.data?.label }))
          });
          handleFlowGenerated(incrementalData, 'voice');
          console.log('✅ handleFlowGenerated called with voice mode');
        }
        
        setIsProcessing(false);
      } else {
        throw new Error('No transcript received');
      }
    } catch (error) {
      console.error('Transcription/Flow generation error:', error);
      setIsProcessing(false);
      // Don't show error toast for transcription failures (often due to silent audio)
      // onError('Failed to process audio chunk: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleRecordingComplete = async (audioBlob) => {
    try {
      setIsProcessing(true);
      setProcessingMessage('Transcribing audio...');
      
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');
      
      const response = await authenticatedFetch(`${API_BASE_URL}/transcribe`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      
      if (data.transcript) {
        setTranscript(data.transcript);
        setIsProcessing(false);
        onSuccess?.('Audio transcribed successfully');
      } else {
        throw new Error('No transcript received');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setIsProcessing(false);
      onError('Failed to transcribe audio: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleUploadAudio = () => {
    fileInputRef.current?.click();
  };

  const handleUploadDocument = () => {
    docInputRef.current?.click();
  };
  
  // Write mode handlers
  const handleStartWriting = () => {
    // If chat is minimized, just restore it without clearing history
    if (isChatMinimized) {
      setIsChatMinimized(false);
      onSuccess?.('Chat restored');
      return;
    }
    
    // Otherwise start fresh
    setIsWriteMode(true);
    setActiveInputMethod('write');
    setWriteMessage('');
    setAccumulatedWriteTranscript('');
    setChatHistory([]);
    setPendingClarification(null);
    setIsClarificationMode(false);
    setIsChatMinimized(false);
    onSuccess?.('Write mode started - describe your process');
  };

  const handleSendMessage = async () => {
    if (!writeMessage.trim()) {
      return;
    }

    const userMessage = writeMessage.trim();
    
    // Add user message to chat history
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setWriteMessage(''); // Clear input immediately

    try {
      setIsProcessing(true);
      setProcessingMessage('Understanding your process...');
      
      // Step 1: Get clarification from AI about what it understood
      const clarificationResponse = await authenticatedFetch(`${API_BASE_URL}/clarify-process-intent`, {
        method: 'POST',
        body: {
          transcript: userMessage,
          accumulatedTranscript: accumulatedWriteTranscript,
          existingFlow: flowDataRef.current || { nodes: [], edges: [] }
        }
      });

      if (!clarificationResponse.ok) {
        const errorData = await clarificationResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to understand your process');
      }

      const clarification = await clarificationResponse.json();
      
      // Add AI clarification to chat with better formatting
      let clarificationMessage = `📋 **New Process Steps:**\n${clarification.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;
      
      if (clarification.structure) {
        clarificationMessage += `\n\n**Flow Structure:**\n${clarification.structure}`;
      }
      
      if (clarification.questions && clarification.questions.length > 0) {
        clarificationMessage += `\n\n**Questions:**\n${clarification.questions.map(q => `• ${q}`).join('\n')}`;
      }
      
      clarificationMessage += `\n\nReply "yes" to generate the flow, or clarify anything that needs adjustment.`;

      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: clarificationMessage,
        clarification: clarification
      }]);
      
      // Update accumulated transcript to include both user message and assistant clarification
      // This ensures the LLM remembers its previous responses in the next turn
      let assistantResponse = '';
      if (clarification.steps && clarification.steps.length > 0) {
        assistantResponse = `I will ${clarification.steps.join(', ')}`;
      }
      if (clarification.questions && clarification.questions.length > 0) {
        if (assistantResponse) assistantResponse += '. ';
        assistantResponse += `Questions: ${clarification.questions.join(' ')}`;
      }
      if (!assistantResponse) {
        assistantResponse = 'I need more clarification.';
      }
      
      const updatedTranscript = accumulatedWriteTranscript + 
        (accumulatedWriteTranscript ? '\n\n' : '') + 
        `User: ${userMessage}\n` +
        `Assistant: ${assistantResponse}`;
      setAccumulatedWriteTranscript(updatedTranscript);
      
      // Store the clarification for when user confirms
      setPendingClarification({
        userMessage,
        clarification,
        clarificationMessage,
        updatedTranscript: updatedTranscript
      });
      setIsClarificationMode(true);
      
      setIsProcessing(false);
      onSuccess?.('Process clarified - please confirm or adjust');
      
    } catch (error) {
      console.error('Clarification error:', error);
      setIsProcessing(false);
      
      // Add error message to chat
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `❌ Error: ${error.message || 'Failed to understand your process'}`
      }]);
      
      onError?.('Failed to clarify process: ' + (error.message || 'Unknown error'));
    }
  };

  const handleConfirmClarification = async () => {
    if (!pendingClarification) return;

    try {
      setIsProcessing(true);
      setProcessingMessage('Generating flow from confirmed process...');
      
      // Step 2: Generate the actual flow using the confirmed understanding
      const currentFlow = flowDataRef.current || { nodes: [], edges: [] };
      
      const response = await authenticatedFetch(`${API_BASE_URL}/generate-incremental-flow`, {
        method: 'POST',
        body: {
          transcript: pendingClarification.userMessage,
          accumulatedTranscript: pendingClarification.updatedTranscript,
          existingFlow: currentFlow,
          sessionId: Date.now(),
          clarification: pendingClarification.clarification // Pass the clarification context
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Flow generation failed');
      }

      const data = await response.json();
      
      if (data && data.nodes) {
        console.log('✍️ Flow generated from confirmed process:', {
          nodeCount: data.nodes.length,
          edgeCount: data.edges?.length
        });
        
        // Generate success message showing NEW nodes added
        const previousNodeCount = (flowDataRef.current?.nodes?.length) || 0;
        const previousEdgeCount = (flowDataRef.current?.edges?.length) || 0;
        const newNodeCount = (data.nodes?.length || 0) - previousNodeCount;
        const newEdgeCount = (data.edges?.length || 0) - previousEdgeCount;
        const successMessage = `✅ Flow updated successfully! Added ${newNodeCount} new process steps with ${newEdgeCount} new connections.`;
        
        // Add success message to chat
        setChatHistory(prev => [...prev, { role: 'assistant', content: successMessage }]);
        
        // Update accumulated transcript to include both user message and assistant clarification
        const fullContext = pendingClarification.updatedTranscript + 
          ` [AI understood: ${pendingClarification.clarification.steps.join(', ')}]`;
        setAccumulatedWriteTranscript(fullContext);
        
        handleFlowGenerated(data, 'write');
      }
      
      // Clear clarification state
      setPendingClarification(null);
      setIsClarificationMode(false);
      setIsProcessing(false);
      onSuccess?.('Flow generated successfully');
      
    } catch (error) {
      console.error('Flow generation error:', error);
      setIsProcessing(false);
      
      // Add error message to chat
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `❌ Error generating flow: ${error.message || 'Unknown error'}`
      }]);
      
      onError?.('Failed to generate flow: ' + (error.message || 'Unknown error'));
    }
  };

  const handleMinimizeChat = () => {
    setIsChatMinimized(!isChatMinimized);
  };

  const handleStopWriting = () => {
    setIsWriteMode(false);
    setWriteMessage('');
    setChatHistory([]);
    setPendingClarification(null);
    setIsClarificationMode(false);
    setActiveInputMethod(null);
    setIsChatMinimized(false); // Reset minimize state
    onSuccess?.('Write mode ended');
  };
  
  const handleError = (error) => {
    setIsProcessing(false);
    onError(error);
  };

  return (
    <div className="unified-workflow-canvas">
      {/* Processing Indicator */}
      {isProcessing && (
        <div className="processing-banner">
          <span className="spinner-small"></span>
          <span>{processingMessage}</span>
        </div>
      )}

      {/* Hidden file inputs */}
      <div style={{ display: 'none' }}>
        <FileUpload 
          ref={fileInputRef}
          onTranscriptionComplete={handleTranscriptionComplete}
          onError={handleError}
        />
        <DocumentUpload 
          ref={docInputRef}
          onFlowGenerated={handleFlowGenerated}
          onError={handleError}
          onUploadStart={() => {
            setIsProcessing(true);
            setProcessingMessage('Processing document and generating flow...');
          }}
        />
      </div>

      {/* Transcript Display (only show for non-voice workflows) */}
      {transcript && activeInputMethod !== 'voice' && (
        <div className="transcript-banner">
          <div className="transcript-content">
            <strong>Transcribed:</strong> {transcript.substring(0, 150)}
            {transcript.length > 150 && '...'}
          </div>
          <button 
            className="btn btn-sm btn-outline"
            onClick={() => setTranscript('')}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Canvas - Flow Chart with integrated toolbar */}
      <div className="canvas-main">
        <FlowChart 
          key={selectedProcess?.id} // Force remount when process changes
          transcript={transcript}
          onError={onError}
          workflowType={activeInputMethod || 'manual'}
          initialFlowData={flowData}
          selectedProcess={selectedProcess}
          onChangeProcess={onChangeProcess}
          onStartRecording={handleStartRecording}
          onStartWriting={handleStartWriting}
          onUploadDocument={handleUploadDocument}
          isRecording={isRecording}
          isPaused={isPaused}
          onPauseRecording={handlePauseRecording}
          onStopRecording={handleStopRecording}
          isWriteMode={isWriteMode}
          writeMessage={writeMessage}
          onWriteMessageChange={setWriteMessage}
          onSendMessage={handleSendMessage}
          onConfirmClarification={handleConfirmClarification}
          onStopWriting={handleStopWriting}
          onMinimizeChat={handleMinimizeChat}
          isChatMinimized={isChatMinimized}
          chatHistory={chatHistory}
          isClarificationMode={isClarificationMode}
          pendingClarification={pendingClarification}
          flowData={flowData}
          isProcessing={isProcessing}
          processingMessage={processingMessage}
          onSaveFinalize={async (flowDataToSave) => {
            // Save & Finalize captures all changes from current nodes/edges
            await handleSaveFlow(flowDataToSave);
          }}
        />
      </div>
    </div>
  );
};

export default UnifiedWorkflowCanvas;


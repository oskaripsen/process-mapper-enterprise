import React, { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { API_BASE_URL, authenticatedFetch } from '../config/api';

const DocumentUpload = forwardRef(({ onFlowGenerated, onError, onUploadStart }, ref) => {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const fileInputRef = useRef(null);

  // Expose click method to parent components
  useImperativeHandle(ref, () => ({
    click: () => {
      fileInputRef.current?.click();
    }
  }));

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, []);

  const handleFileInput = useCallback((e) => {
    const files = Array.from(e.target.files);
    handleFiles(files);
  }, []);

  const handleFiles = (files) => {
    // Filter for supported file types
    const supportedFiles = files.filter(file => {
      const ext = file.name.toLowerCase().split('.').pop();
      return ['pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg'].includes(ext);
    });

    if (supportedFiles.length === 0) {
      onError('No supported files found. Please upload PDF, DOCX, PPTX, PNG, or JPEG files.');
      return;
    }

    if (supportedFiles.length < files.length) {
      onError('Some files were skipped. Only PDF, DOCX, PPTX, PNG, and JPEG files are supported.');
    }

    setSelectedFiles(supportedFiles);
    
    // Auto-upload when files are selected (for hidden input mode)
    if (supportedFiles.length > 0) {
      uploadFiles(supportedFiles);
    }
  };

  const uploadFiles = async (filesToUpload) => {
    const files = filesToUpload || selectedFiles;
    
    if (files.length === 0) {
      onError('Please select files to upload');
      return;
    }

    // Check total size (20MB limit)
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 20 * 1024 * 1024) {
      onError('Total file size exceeds 20MB limit. Please select fewer or smaller files.');
      return;
    }

    setUploading(true);
    onUploadStart?.(); // Notify parent that upload has started

    try {
      console.log('Uploading files:', files.map(f => f.name));
      console.log('🔧 Uploading to URL:', `${API_BASE_URL}/upload-doc`);

      // Process files one at a time since backend only accepts one file per request
      let combinedData = null;
      
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file); // Use 'file' (singular) as expected by backend

        console.log(`📤 Uploading file: ${file.name}`);

        const response = await authenticatedFetch(`${API_BASE_URL}/upload-doc`, {
          method: 'POST',
          body: formData,
          // Note: Don't set Content-Type for FormData, let the browser set it with boundary
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || `Upload failed for ${file.name}`);
        }

        const data = await response.json();

        console.log(`📄 Upload response for ${file.name}:`, data);
        console.log('  - Has nodes?', !!data.nodes);
        console.log('  - Has edges?', !!data.edges);
        console.log('  - Has extracted_text?', !!data.extracted_text);

        // Check if we have flow data (nodes and edges)
        if (!data.nodes || !data.edges) {
          console.warn(`No flow data received for ${file.name}, skipping...`);
          continue;
        }

        // For multiple files, use the data from the last successful file
        // In the future, this could be enhanced to merge data from multiple files
        combinedData = data;
      }

      if (!combinedData) {
        throw new Error('No flow data received from any uploaded files');
      }

      // Notify parent with the flow data
      if (onFlowGenerated) {
        console.log('✅ Calling onFlowGenerated with combined data');
        onFlowGenerated(combinedData);
      }

      // Clear selected files after successful upload
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Upload error:', error);
      onError(error.response?.data?.detail || error.message || 'Failed to upload and process documents');
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    await uploadFiles(selectedFiles);
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getTotalSize = () => {
    const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    return formatFileSize(total);
  };

  return (
    <div className="document-upload">
      {/* Drop Zone */}
      <div
        className={`upload-area ${dragging ? 'dragover' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          id="doc-file-input"
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
          onChange={handleFileInput}
          disabled={uploading}
        />
        
        {uploading ? (
          <div className="upload-text">
            <div className="spinner"></div>
            <p style={{ marginTop: '1rem' }}>Processing documents...</p>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>Extracting text and images using AI...</p>
          </div>
        ) : (
          <div className="upload-text">
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📄</div>
            <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
              Drop files here or click to browse
            </p>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Supports: PDF, DOCX, PPTX, PNG, JPEG (max 20MB total)
            </p>
          </div>
        )}
      </div>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="selected-files">
          <h4 style={{ marginBottom: '0.75rem', color: '#333' }}>
            Selected Files ({selectedFiles.length}) - Total: {getTotalSize()}
          </h4>
          <div className="files-list">
            {selectedFiles.map((file, index) => (
              <div key={index} className="file-item">
                <div className="file-info">
                  <span className="file-icon">
                    {file.name.endsWith('.pdf') ? '📕' : 
                     file.name.endsWith('.docx') ? '📘' :
                     file.name.endsWith('.pptx') ? '📙' : '🖼️'}
                  </span>
                  <div className="file-details">
                    <div className="file-name">{file.name}</div>
                    <div className="file-size">{formatFileSize(file.size)}</div>
                  </div>
                </div>
                {!uploading && (
                  <button
                    className="remove-file"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    title="Remove file"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Button */}
      {selectedFiles.length > 0 && (
        <div className="upload-actions">
          <button
            className="control-button"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? 'Processing...' : `Upload ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`}
          </button>
          {!uploading && (
            <button
              className="control-button secondary"
              onClick={() => setSelectedFiles([])}
            >
              Clear All
            </button>
          )}
        </div>
      )}

      <style>{`
        .document-upload {
          max-width: 600px;
          margin: 0 auto;
        }

        .selected-files {
          margin-top: 1.5rem;
          padding: 1rem;
          background: white;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }

        .files-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .file-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem;
          background: #f8f9fa;
          border-radius: 6px;
          border: 1px solid #e5e7eb;
          transition: all 0.2s ease;
        }

        .file-item:hover {
          background: #f0f1f3;
          border-color: #d1d5db;
        }

        .file-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex: 1;
          min-width: 0;
        }

        .file-icon {
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .file-details {
          flex: 1;
          min-width: 0;
        }

        .file-name {
          font-size: 0.9rem;
          font-weight: 500;
          color: #333;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .file-size {
          font-size: 0.75rem;
          color: #666;
        }

        .remove-file {
          background: #dc3545;
          color: white;
          border: none;
          border-radius: 50%;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .remove-file:hover {
          background: #c82333;
          transform: scale(1.1);
        }

        .upload-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 1rem;
          justify-content: center;
        }
      `}</style>
    </div>
  );
});

export default DocumentUpload;



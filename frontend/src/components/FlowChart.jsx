import { API_BASE_URL, authenticatedFetch } from '../config/api';
import React, { useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge, // Enables edge reconnection functionality
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as htmlToImage from 'html-to-image';
import { v4 as uuidv4 } from 'uuid';
import dagre from 'dagre';



// Helper function to generate logical IDs
const getNextLogicalId = (existingNodes) => {
  if (!existingNodes || existingNodes.length === 0) {
    return "1.1.1.1";
  }
  
  // Find the highest existing logical ID with 1.1.1. prefix
  let maxId = "1.1.1.0";
  for (const node of existingNodes) {
    const logicalId = node.data?.logical_id;
    if (logicalId && logicalId.startsWith("1.1.1.") && logicalId > maxId) {
      maxId = logicalId;
    }
  }
  
  // Parse and increment
  const parts = maxId.split('.');
  if (parts.length >= 4) {
    try {
      const lastNum = parseInt(parts[parts.length - 1]);
      parts[parts.length - 1] = (lastNum + 1).toString();
      return parts.join('.');
    } catch (e) {
      // Fallback
    }
  }
  
  return "1.1.1.1";
};

// Helper function to renumber IDs based on flow sequence
const renumberByFlowSequence = (nodes, edges) => {
  if (!nodes || nodes.length === 0) {
    return nodes;
  }
  
  // Create a mapping of node IDs to nodes
  const nodeMap = {};
  nodes.forEach(node => {
    nodeMap[node.id] = node;
  });
  
  // Find start nodes (nodes with no incoming edges)
  const incomingEdges = new Set(edges.map(edge => edge.target));
  const startNodes = nodes.filter(node => !incomingEdges.has(node.id));
  
  // If no clear start nodes, use the first node
  const actualStartNodes = startNodes.length > 0 ? startNodes : [nodes[0]];
  
  // Create adjacency list for flow traversal
  const adjacency = {};
  edges.forEach(edge => {
    if (!adjacency[edge.source]) {
      adjacency[edge.source] = [];
    }
    adjacency[edge.source].push(edge.target);
  });
  
  // Traverse the flow and assign sequential IDs (excluding start/end nodes)
  const visited = new Set();
  const updatedNodes = [];
  let counter = 1;
  
  const traverseFlow = (nodeId) => {
    if (visited.has(nodeId) || !nodeMap[nodeId]) {
      return;
    }
    
    visited.add(nodeId);
    const node = { ...nodeMap[nodeId] };
    
    // Only assign logical IDs to default process steps (not start/end/decision/merge nodes)
    const nodeType = node.type;
    if (nodeType === 'start' || nodeType === 'end' || nodeType === 'decision' || nodeType === 'merge') {
      // Start, end, decision, and merge nodes keep their existing logical_id or get empty
      node.data = { ...node.data, logical_id: node.data?.logical_id || '' };
    } else {
      // Only default process steps get sequential numbering
      node.data = { ...node.data, logical_id: `1.1.1.${counter}` };
      counter++;
    }
    
    updatedNodes.push(node);
    
    // Continue to connected nodes
    if (adjacency[nodeId]) {
      adjacency[nodeId].forEach(nextNodeId => {
        traverseFlow(nextNodeId);
      });
    }
  };
  
  // Start traversal from all start nodes
  actualStartNodes.forEach(startNode => {
    traverseFlow(startNode.id);
  });
  
  // Handle any remaining unvisited nodes (orphaned nodes)
  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      const updatedNode = { ...node };
      const nodeType = updatedNode.type;
      if (nodeType === 'start' || nodeType === 'end' || nodeType === 'decision' || nodeType === 'merge') {
        // Start, end, decision, and merge nodes keep their existing logical_id or get empty
        updatedNode.data = { ...node.data, logical_id: node.data?.logical_id || '' };
      } else {
        // Only default process steps get sequential numbering
        updatedNode.data = { ...node.data, logical_id: `1.1.1.${counter}` };
        counter++;
      }
      updatedNodes.push(updatedNode);
    }
  });
  
  return updatedNodes;
};

// Helper function to handle mid-step insertion
const handleMidStepInsertion = (newNode, targetEdge, nodes, edges) => {
  if (!targetEdge) return { nodes, edges };
  
  const sourceNode = nodes.find(n => n.id === targetEdge.source);
  const targetNode = nodes.find(n => n.id === targetEdge.target);
  
  if (!sourceNode || !targetNode) return { nodes, edges };
  
  // Create the new node with proper positioning
  const newNodeWithPosition = {
    ...newNode,
    position: {
      x: (sourceNode.position.x + targetNode.position.x) / 2,
      y: (sourceNode.position.y + targetNode.position.y) / 2
    }
  };
  
  // Remove the original edge
  const filteredEdges = edges.filter(e => e.id !== targetEdge.id);
  
  // Create two new edges: source -> newNode and newNode -> target
  const edge1 = {
    id: `e-${Date.now()}-1`,
    source: targetEdge.source,
    target: newNode.id,
    type: 'step',
    style: { strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
    },
    reconnectable: true,
  };
  
  const edge2 = {
    id: `e-${Date.now()}-2`,
    source: newNode.id,
    target: targetEdge.target,
    type: 'step',
    style: { strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
    },
    reconnectable: true,
  };
  
  // Add the new node and edges
  const newNodes = [...nodes, newNodeWithPosition];
  const newEdges = [...filteredEdges, edge1, edge2];
  
  // Renumber logical IDs based on new flow sequence
  const renumberedNodes = renumberByFlowSequence(newNodes, newEdges);
  
  return { nodes: renumberedNodes, edges: newEdges };
};

// Helper function to show error messages with auto-dismiss
const showErrorMessage = (message, setErrorMessage, setShowError) => {
  setErrorMessage(message);
  setShowError(true);
  
  // Auto-dismiss after 2 seconds
  setTimeout(() => {
    setShowError(false);
    setTimeout(() => {
      setErrorMessage('');
    }, 300); // Wait for fade-out animation
  }, 2000);
};

// Custom Merge Node Component
const MergeNode = ({ data, selected, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data.label);

  const handleTextClick = () => {
    setIsEditing(true);
    setEditText(data.label);
  };

  const handleTextChange = (e) => {
    setEditText(e.target.value);
  };

  const handleTextBlur = () => {
    setIsEditing(false);
    if (editText !== data.label) {
      data.label = editText;
      data.user_modified = true;
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleTextBlur();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Circular merge node */}
    <div 
      className={`merge-node ${selected ? 'selected' : ''}`}
      style={{
        width: '60px',
        height: '60px',
        borderRadius: '50%',
        border: '2px solid #007bff',
        background: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
          position: 'relative',
        }}
      >
      
      {/* Merge node handles: Right outgoing, others incoming */}
      {/* Multiple incoming connections can use the same handles when needed */}
      <Handle 
        type="target" 
        position={Position.Top} 
        id="top" 
        style={{ 
          background: '#007bff',
          width: '10px',
          height: '10px',
          left: '-5px',
          top: '-5px'
        }}
      />
      <Handle 
        type="target" 
        position={Position.Left} 
        id="left" 
        style={{ 
          background: '#007bff',
          width: '10px',
          height: '10px',
          left: '-5px',
          top: '50%',
          transform: 'translateY(-50%)'
        }}
      />
      <Handle 
        type="source" 
        position={Position.Right} 
        id="right" 
        style={{ 
          background: '#007bff',
          width: '10px',
          height: '10px',
          right: '-5px',
          top: '50%',
          transform: 'translateY(-50%)'
        }}
      />
      <Handle 
        type="target" 
        position={Position.Bottom} 
        id="bottom" 
        style={{ 
          background: '#007bff',
          width: '10px',
          height: '10px',
          left: '-5px',
          bottom: '-5px'
        }}
      />
      </div>
      
      {/* Text label below the merge node */}
      <div style={{
        marginTop: '8px',
        maxWidth: '120px',
        textAlign: 'center',
      }}>
      {isEditing ? (
        <input
          type="text"
          value={editText}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          onKeyPress={handleKeyPress}
          style={{
            background: 'transparent',
              border: '1px solid #007bff',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
            fontWeight: '500',
            color: '#333',
            textAlign: 'center',
            width: '100%',
            fontFamily: 'inherit',
              outline: 'none',
              direction: 'ltr',
              unicodeBidi: 'normal',
          }}
          autoFocus
        />
      ) : (
          <span 
            onClick={handleTextClick} 
            style={{ 
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '500',
              color: '#333',
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: '1.3',
            }}
          >
          {data.label}
        </span>
      )}
      </div>
    </div>
  );
};

// Custom Start Node Component
const StartNode = ({ data, selected, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data.label);

  const handleTextClick = () => {
    setIsEditing(true);
    setEditText(data.label);
  };

  const handleTextChange = (e) => {
    setEditText(e.target.value);
  };

  const handleTextBlur = () => {
    setIsEditing(false);
    if (editText !== data.label) {
      data.label = editText;
      data.user_modified = true;
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleTextBlur();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Oval start node */}
    <div 
      className={`start-node ${selected ? 'selected' : ''}`}
      style={{
        width: '80px',
        height: '40px',
        borderRadius: '20px',
        border: '2px solid #28a745',
        background: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
          position: 'relative',
        }}
      >
        
        <Handle type="source" position={Position.Right} />
      </div>
      
      {/* Text label below the start node */}
      <div style={{
        marginTop: '8px',
        maxWidth: '120px',
        textAlign: 'center',
      }}>
      {isEditing ? (
        <input
          type="text"
          value={editText}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          onKeyPress={handleKeyPress}
          style={{
            background: 'transparent',
              border: '1px solid #28a745',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
            fontWeight: '500',
            color: '#333',
            textAlign: 'center',
            width: '100%',
            fontFamily: 'inherit',
              outline: 'none',
              direction: 'ltr',
              unicodeBidi: 'normal',
          }}
          autoFocus
        />
      ) : (
          <span 
            onClick={handleTextClick} 
            style={{ 
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '500',
              color: '#333',
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: '1.3',
            }}
          >
          {data.label}
        </span>
      )}
      </div>
    </div>
  );
};

// Custom End Node Component
const EndNode = ({ data, selected, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data.label);

  const handleTextClick = () => {
    setIsEditing(true);
    setEditText(data.label);
  };

  const handleTextChange = (e) => {
    setEditText(e.target.value);
  };

  const handleTextBlur = () => {
    setIsEditing(false);
    if (editText !== data.label) {
      data.label = editText;
      data.user_modified = true;
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleTextBlur();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Oval end node */}
    <div 
      className={`end-node ${selected ? 'selected' : ''}`}
      style={{
        width: '80px',
        height: '40px',
        borderRadius: '20px',
        border: '2px solid #dc3545',
        background: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
          position: 'relative',
        }}
      >
        
        <Handle type="target" position={Position.Left} />
      </div>
      
      {/* Text label below the end node */}
      <div style={{
        marginTop: '8px',
        maxWidth: '120px',
        textAlign: 'center',
      }}>
      {isEditing ? (
        <input
          type="text"
          value={editText}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          onKeyPress={handleKeyPress}
          style={{
            background: 'transparent',
              border: '1px solid #dc3545',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
            fontWeight: '500',
            color: '#333',
            textAlign: 'center',
            width: '100%',
            fontFamily: 'inherit',
              outline: 'none',
              direction: 'ltr',
              unicodeBidi: 'normal',
          }}
          autoFocus
        />
      ) : (
          <span 
            onClick={handleTextClick} 
            style={{ 
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '500',
              color: '#333',
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: '1.3',
            }}
          >
          {data.label}
        </span>
      )}
      </div>
    </div>
  );
};

// Custom Decision Node Component
const DecisionNode = ({ data, selected, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data.label);


  const handleTextClick = () => {
    setIsEditing(true);
    setEditText(data.label);
  };

  const handleTextChange = (e) => {
    setEditText(e.target.value);
    // Don't update data.label here to avoid interference with text input
    // It will be updated in handleTextBlur
  };

  const handleTextBlur = () => {
    setIsEditing(false);
    // Update the node data
    if (editText !== data.label) {
      data.label = editText;
      data.user_modified = true;
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleTextBlur();
    }
  };

  // Fixed compact diamond size
  const diamondSize = 60;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Diamond decision node */}
      <div 
        className={`decision-node ${selected ? 'selected' : ''}`}
      style={{
        width: `${diamondSize}px`,
        height: `${diamondSize}px`,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
      }}
    >
      {/* Diamond shape using CSS transform */}
      <div
        style={{
          width: `${diamondSize}px`,
          height: `${diamondSize}px`,
          background: '#fff',
          border: '2px solid #007bff',
          transform: 'rotate(45deg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: selected ? '0 0 0 2px #007bff' : '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        {/* Question mark icon inside diamond */}
        <div 
          style={{
            transform: 'rotate(-45deg)',
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#007bff',
          }}
        >
          ?
        </div>
      </div>
      
      {/* Connection handles */}
      {/* All four connection handles for decision nodes */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ 
          background: '#007bff',
          width: '8px',
          height: '8px',
          left: '-4px',
        }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ 
          background: '#007bff',
          width: '8px',
          height: '8px',
          top: '-4px',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ 
          background: '#007bff',
          width: '8px',
          height: '8px',
          right: '-4px',
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ 
          background: '#007bff',
          width: '8px',
          height: '8px',
          bottom: '-4px',
        }}
      />
      </div>
      
      {/* Text label below the decision node */}
      <div style={{
        marginTop: '12px',
        maxWidth: '140px',
        textAlign: 'center',
      }}>
        {isEditing ? (
          <input
            type="text"
            value={editText}
            onChange={handleTextChange}
            onBlur={handleTextBlur}
            onKeyPress={handleKeyPress}
            style={{
              background: 'transparent',
              border: '1px solid #007bff',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: '500',
              color: '#333',
              textAlign: 'center',
              width: '100%',
              fontFamily: 'inherit',
              outline: 'none',
              direction: 'ltr',
              unicodeBidi: 'normal',
            }}
            autoFocus
          />
        ) : (
          <span 
            onClick={handleTextClick} 
            style={{ 
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '500',
              color: '#333',
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: '1.3',
            }}
          >
            {data.label}
          </span>
        )}
      </div>
    </div>
  );
};

// Custom Default Node Component for regular task nodes
const DefaultNode = ({ data, selected, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data.label);
  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [editOwner, setEditOwner] = useState(data.owner || 'TBD');
  const [isEditingSystem, setIsEditingSystem] = useState(false);
  const [editSystem, setEditSystem] = useState(data.system || 'TBD');

  const handleTextClick = () => {
    setIsEditing(true);
    setEditText(data.label);
  };

  const handleTextChange = (e) => {
    setEditText(e.target.value);
    // Don't update data.label here to avoid interference with text input
    // It will be updated in handleTextBlur
  };

  const handleTextBlur = () => {
    setIsEditing(false);
    // Update the node data
    if (editText !== data.label) {
      data.label = editText;
      data.user_modified = true;
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleTextBlur();
    }
    // Allow Shift+Enter for line breaks
  };

  const handleOwnerClick = () => {
    setIsEditingOwner(true);
    setEditOwner(data.owner || 'TBD');
  };

  const handleOwnerChange = (e) => {
    setEditOwner(e.target.value);
  };

  const handleOwnerBlur = () => {
    setIsEditingOwner(false);
    if (editOwner !== data.owner) {
      data.owner = editOwner;
      data.user_modified = true;
    }
  };

  const handleOwnerKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleOwnerBlur();
    }
  };

  const handleSystemClick = () => {
    setIsEditingSystem(true);
    setEditSystem(data.system || 'TBD');
  };

  const handleSystemChange = (e) => {
    setEditSystem(e.target.value);
  };

  const handleSystemBlur = () => {
    setIsEditingSystem(false);
    if (editSystem !== data.system) {
      data.system = editSystem;
      data.user_modified = true;
    }
  };

  const handleSystemKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSystemBlur();
    }
  };

  const toggleManualAutomated = () => {
    const newValue = data.manualOrAutomated === 'manual' ? 'automated' : 'manual';
    data.manualOrAutomated = newValue;
    data.user_modified = true;
    // Force re-render by updating state
    setEditText(data.label); // This will trigger a re-render
  };

  // Default node size - increased to accommodate new elements
  const defaultWidth = 160;
  const defaultHeight = 100;
  
  // Calculate text wrapping within default node size
  const textLines = editText.split('\n');
  
  // Define text wrapping parameters for default size
  const defaultCharsPerLine = 20; // Characters that fit in default width
  const defaultMaxLines = 3; // Lines that fit in default height
  
  // Calculate how many lines the text will take with word wrapping at default width
  const estimatedWrappedLines = Math.max(
    textLines.length, // Lines from explicit line breaks
    Math.ceil(editText.length / defaultCharsPerLine) // Estimated lines from word wrapping
  );
  
  // Only expand if text exceeds the default capacity
  const needsHeightExpansion = estimatedWrappedLines > defaultMaxLines;
  const needsWidthExpansion = estimatedWrappedLines > defaultMaxLines && 
                             Math.max(...textLines.map(line => line.length)) > defaultCharsPerLine * 1.5;
  
  // Calculate sizes - prioritize height expansion over width
  let nodeWidth = defaultWidth;
  let nodeHeight = defaultHeight;
  
  if (needsHeightExpansion) {
    // First expand height to accommodate more lines
    nodeHeight = Math.max(estimatedWrappedLines * 20, defaultHeight);
  }
  
  if (needsWidthExpansion) {
    // Only expand width if height expansion isn't enough
    const maxLineLength = Math.max(...textLines.map(line => line.length));
    const requiredWidth = Math.max(maxLineLength * 7, defaultWidth + 40);
    nodeWidth = requiredWidth;
  }

  // Extract metadata from data
  const nodeId = data.logical_id || data.id || id;
  const owner = data.owner || 'TBD';
  const system = data.system || 'TBD';
  const manualOrAutomated = data.manualOrAutomated || 'manual';
  const nodeType = data.type || 'default';

  return (
    <div 
      key={id}
      className={`default-node ${selected ? 'selected' : ''}`}
      style={{
        width: `${nodeWidth}px`,
        height: `${nodeHeight}px`,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        border: '2px solid #007bff',
        borderRadius: '8px',
        boxShadow: selected ? '0 0 0 2px #007bff' : '0 2px 4px rgba(0,0,0,0.1)',
        padding: '8px',
        fontSize: '12px',
        fontWeight: '500',
        color: '#333',
        textAlign: 'center',
        lineHeight: '1.2',
        minWidth: `${nodeWidth}px`,
        minHeight: `${nodeHeight}px`,
        maxWidth: `${nodeWidth}px`,
        maxHeight: `${nodeHeight}px`,
      }}
    >
      {/* Node ID - top left (only for default process steps, not start/end/decision/merge nodes) */}
      {nodeType === 'default' && nodeId && (
        <div style={{
          position: 'absolute',
          top: '-20px',
          left: '-2px',
          fontSize: '10px',
          fontWeight: 'bold',
          color: '#666',
          background: '#f8f9fa',
          padding: '2px 6px',
          borderRadius: '4px',
          border: '1px solid #dee2e6',
          whiteSpace: 'nowrap'
        }}>
          {nodeId}
        </div>
      )}

      {/* A/M Indicator - top right corner */}
      <div 
        onClick={toggleManualAutomated}
        style={{
          position: 'absolute',
          top: '-8px',
          right: '-8px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: data.manualOrAutomated === 'automated' ? '#28a745' : '#ffc107',
          color: 'white',
          fontSize: '10px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
        title={`Click to toggle: ${data.manualOrAutomated === 'automated' ? 'Automated' : 'Manual'}`}
        onMouseEnter={(e) => {
          e.target.style.transform = 'scale(1.1)';
          e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'scale(1)';
          e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        }}
      >
        {data.manualOrAutomated === 'automated' ? 'A' : 'M'}
      </div>

      {/* Main process step content */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 0',
        width: '100%',
        maxWidth: `${nodeWidth - 16}px`, // Account for padding
        overflow: 'hidden'
      }}>
      {isEditing ? (
        <textarea
          value={editText}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          onKeyPress={handleKeyPress}
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: '12px',
            fontWeight: '500',
            color: '#333',
            textAlign: 'center',
            width: '100%',
            maxWidth: '100%',
            height: '100%',
            fontFamily: 'inherit',
            resize: 'none',
            overflow: 'hidden',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            lineHeight: '1.3',
            padding: '2px',
            hyphens: 'auto',
            direction: 'ltr',
            unicodeBidi: 'normal',
          }}
          autoFocus
          rows={Math.max(2, Math.ceil(editText.length / 25))}
        />
      ) : (
        <span
          onClick={handleTextClick}
          style={{
            cursor: 'pointer',
            width: '100%',
            maxWidth: '100%',
            display: 'block',
            direction: 'ltr', // Ensure left-to-right text direction
            textAlign: 'center',
            unicodeBidi: 'normal', // Prevent bidirectional text issues
            whiteSpace: 'normal', // Allow text to wrap
            wordBreak: 'break-word', // Break long words if necessary
            lineHeight: '1.3', // Slightly increased line height for better readability
            padding: '2px', // Add small padding for better text spacing
            overflow: 'hidden',
            hyphens: 'auto', // Enable automatic hyphenation
          }}
        >
          {data.label}
        </span>
      )}
      </div>

      {/* Metadata boxes - stacked beneath description */}
      <div style={{
        position: 'absolute',
        bottom: '-70px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        alignItems: 'center'
      }}>
        {/* Owner box */}
        <div 
          className="editable-metadata-box"
        style={{ 
            fontSize: '11px',
            fontWeight: '600',
            color: '#333',
            background: isEditingOwner ? '#fff' : '#ffffff',
            padding: '6px 10px',
            borderRadius: '6px',
            border: isEditingOwner ? '2px solid #007bff' : '2px solid #28a745',
            whiteSpace: 'nowrap',
            minWidth: '80px',
            maxWidth: '140px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isEditingOwner ? '0 0 0 2px rgba(0,123,255,0.25)' : '0 2px 6px rgba(0,0,0,0.15)'
          }}
          onClick={handleOwnerClick}
          title="Click to edit owner/role"
          onMouseEnter={(e) => {
            if (!isEditingOwner) {
              e.target.style.background = '#f8fff8';
              e.target.style.borderColor = '#20c997';
              e.target.style.transform = 'scale(1.05)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isEditingOwner) {
              e.target.style.background = '#ffffff';
              e.target.style.borderColor = '#28a745';
              e.target.style.transform = 'scale(1)';
            }
          }}
        >
          {isEditingOwner ? (
            <input
              type="text"
              value={editOwner}
              onChange={handleOwnerChange}
              onBlur={handleOwnerBlur}
              onKeyPress={handleOwnerKeyPress}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '11px',
                fontWeight: '500',
                color: '#333',
                width: '100%',
                fontFamily: 'inherit',
                padding: 0,
                margin: 0,
                direction: 'ltr',
                unicodeBidi: 'normal'
              }}
              autoFocus
            />
          ) : (
            <>👤 {data.owner || 'TBD'}</>
          )}
        </div>

        {/* Tool box */}
        <div 
          className="editable-metadata-box"
        style={{ 
            fontSize: '11px',
            fontWeight: '600',
            color: '#333',
            background: isEditingSystem ? '#fff' : '#ffffff',
            padding: '6px 10px',
            borderRadius: '6px',
            border: isEditingSystem ? '2px solid #007bff' : '2px solid #fd7e14',
            whiteSpace: 'nowrap',
            minWidth: '80px',
            maxWidth: '140px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isEditingSystem ? '0 0 0 2px rgba(0,123,255,0.25)' : '0 2px 6px rgba(0,0,0,0.15)'
          }}
          onClick={handleSystemClick}
          title="Click to edit tool/system"
          onMouseEnter={(e) => {
            if (!isEditingSystem) {
              e.target.style.background = '#fff8f0';
              e.target.style.borderColor = '#e8590c';
              e.target.style.transform = 'scale(1.05)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isEditingSystem) {
              e.target.style.background = '#ffffff';
              e.target.style.borderColor = '#fd7e14';
              e.target.style.transform = 'scale(1)';
            }
          }}
        >
          {isEditingSystem ? (
            <input
              type="text"
              value={editSystem}
              onChange={handleSystemChange}
              onBlur={handleSystemBlur}
              onKeyPress={handleSystemKeyPress}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '11px',
                fontWeight: '500',
                color: '#333',
                width: '100%',
                fontFamily: 'inherit',
                padding: 0,
                margin: 0,
                direction: 'ltr',
                unicodeBidi: 'normal'
              }}
              autoFocus
            />
          ) : (
            <>🛠️ {data.system || 'TBD'}</>
          )}
        </div>
      </div>
      
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ 
          background: '#007bff',
          width: '8px',
          height: '8px',
          left: '-4px',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ 
          background: '#007bff',
          width: '8px',
          height: '8px',
          right: '-4px',
        }}
      />
    </div>
  );
};

// Node types
// Define nodeTypes outside component to avoid React Flow warnings
const nodeTypes = {
  decision: DecisionNode,
  default: DefaultNode,
  merge: MergeNode,
  start: StartNode,
  end: EndNode,
};



// Dagre layout function
  const getLayoutedElements = (nodes, edges, direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 150, nodesep: 80 });

  // Set node dimensions based on type
  nodes.forEach((node) => {
    let width = 200;
    let height = 100;
    
    // Adjust dimensions based on node type
    if (node.type === 'decision') {
      width = 140; // 60px diamond + margin for text below
      height = 100; // 60px diamond + 12px margin + text height
    } else if (node.type === 'merge') {
      width = 120; // 60px circle + margin for text below
      height = 100; // 60px circle + 12px margin + text height
    } else if (node.type === 'start' || node.type === 'end') {
      width = 120; // 80px oval + margin for text below
      height = 80; // 40px oval + 8px margin + text height
    } else {
      width = 180; // default process node
      height = 120;
    }
    
    dagreGraph.setNode(node.id, { width, height });
  });

  // Configure edges with proper handles for decision nodes
  const edgesWithHandles = edges.map((edge) => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    
    // For decision nodes with multiple outputs, assign different handles
    if (sourceNode?.type === 'decision') {
      // Count outgoing edges from this decision node
      const outgoingEdges = edges.filter(e => e.source === edge.source);
      
      if (outgoingEdges.length <= 3) {
        // Assign specific handles: right, top, bottom
        const edgeIndex = outgoingEdges.indexOf(edge);
        const handles = ['right', 'top', 'bottom'];
        
        return {
          ...edge,
          sourceHandle: handles[edgeIndex] || 'right',
        };
      }
    }
    
    return edge;
  });

  edgesWithHandles.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    
    // Calculate offset based on node type for proper centering
    let offsetX = 100;
    let offsetY = 50;
    
    if (node.type === 'decision') {
      offsetX = 70;
      offsetY = 50;
    } else if (node.type === 'merge') {
      offsetX = 60;
      offsetY = 50;
    } else if (node.type === 'start' || node.type === 'end') {
      offsetX = 60;
      offsetY = 40;
    } else {
      offsetX = 90;
      offsetY = 60;
    }
    
    return {
      ...node,
      targetPosition: 'left',
      sourcePosition: 'right',
      position: {
        x: nodeWithPosition.x - offsetX,
        y: nodeWithPosition.y - offsetY,
      },
    };
  });

  return { nodes: layoutedNodes, edges: edgesWithHandles };
};

const FlowChart = ({ transcript, onError, onNewTranscript, workflowType, initialFlowData, onSaveFlow, processId, processName, onStartRecording, onStartWriting, onUploadDocument, isRecording, isPaused, onPauseRecording, onStopRecording, isWriteMode, writeMessage, onWriteMessageChange, onSendMessage, onConfirmClarification, onStopWriting, onMinimizeChat, isChatMinimized, chatHistory, isClarificationMode, pendingClarification, flowData, onSaveFinalize, selectedProcess, onChangeProcess, isProcessing, processingMessage }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  // State declarations
  const [isGenerating, setIsGenerating] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [selectedTool, setSelectedTool] = useState('select');
  const [isMidStepInsertion, setIsMidStepInsertion] = useState(false);
  const [targetEdgeForInsertion, setTargetEdgeForInsertion] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showError, setShowError] = useState(false);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [isEditingEdge, setIsEditingEdge] = useState(false);
  const [edgeLabel, setEdgeLabel] = useState('');
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [flowType, setFlowType] = useState('simple'); // Default to simple flow
  const [showAddDecisionDropdown, setShowAddDecisionDropdown] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [workshopSession, setWorkshopSession] = useState(null);
  const [accumulatedTranscript, setAccumulatedTranscript] = useState('');
  const [recordingStatus, setRecordingStatus] = useState('idle'); // 'idle', 'recording', 'processing'
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [processingInterval, setProcessingInterval] = useState(null);
  const [aiProcessingStatus, setAiProcessingStatus] = useState('idle'); // 'idle', 'transcribing', 'generating'
  const [lastProcessedTranscript, setLastProcessedTranscript] = useState('');
  const flowRef = useRef(null);
  const currentNodesRef = useRef([]);
  const currentEdgesRef = useRef([]);

  // Update refs whenever nodes or edges change
  React.useEffect(() => {
    currentNodesRef.current = nodes;
    currentEdgesRef.current = edges;
  }, [nodes, edges]);
  
  // Handle initial flow data from document upload
  React.useEffect(() => {
    if (initialFlowData && initialFlowData.nodes && initialFlowData.edges) {
      console.log('Loading initial flow data from document upload:', initialFlowData);
      setNodes(initialFlowData.nodes || []);
      setEdges(initialFlowData.edges || []);
    }
  }, [initialFlowData]);

  // Handle incremental flow data updates (from voice input)
  React.useEffect(() => {
    if (flowData && flowData.nodes && flowData.edges) {
      console.log('🔄 Loading flow data update:', {
        nodeCount: flowData.nodes.length,
        edgeCount: flowData.edges.length,
        nodes: flowData.nodes.map(n => ({ id: n.id, label: n.data?.label }))
      });
      setNodes(flowData.nodes || []);
      setEdges(flowData.edges || []);
      
      // Force a small delay to ensure React Flow updates
      setTimeout(() => {
        console.log('✅ Flow data applied, current nodes:', nodes.length);
      }, 100);
    }
  }, [flowData]);

  // Debug logging for flow visibility
  React.useEffect(() => {
    console.log('FlowChart render state:', {
      nodesCount: nodes.length,
      edgesCount: edges.length,
      isMaximized,
      workflowType,
      transcript: transcript?.substring(0, 50) + '...',
      flowData: !!flowData,
      initialFlowData: !!initialFlowData,
      initialFlowDataNodes: initialFlowData?.nodes?.length,
      initialFlowDataEdges: initialFlowData?.edges?.length
    });
  }, [nodes.length, edges.length, isMaximized, workflowType, transcript, flowData, initialFlowData]);

  // Force React Flow to update dimensions when nodes change
  React.useEffect(() => {
    if (nodes.length > 0) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length]);
  
  // Custom handler to track user modifications
  const handleNodesChange = useCallback((changes) => {
    // Mark nodes as user modified when they are moved or resized
    const updatedChanges = changes.map(change => {
      if (change.type === 'position' || change.type === 'dimensions') {
        return {
          ...change,
          data: {
            ...change.data,
            user_modified: true
          }
        };
      }
      return change;
    });
    
    onNodesChange(updatedChanges);
  }, [onNodesChange]);


  // History management functions
  const saveToHistory = (newNodes, newEdges) => {
    const newState = {
      nodes: JSON.parse(JSON.stringify(newNodes)),
      edges: JSON.parse(JSON.stringify(newEdges)),
      timestamp: Date.now()
    };
    
    // Remove any history after current index (when user makes new changes after undo)
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    
    // Limit history to 50 states to prevent memory issues
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }
    
    setHistory(newHistory);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const state = history[newIndex];
      setNodes(state.nodes);
      setEdges(state.edges);
      setHistoryIndex(newIndex);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const state = history[newIndex];
      setNodes(state.nodes);
      setEdges(state.edges);
      setHistoryIndex(newIndex);
    }
  };

  const generateFlow = async () => {
    if (!transcript.trim() && workflowType !== 'live') {
      showErrorMessage('No transcript available to generate flow', setErrorMessage, setShowError);
      return;
    }

    // No methodology selection needed - use simple flow

    setIsGenerating(true);
    
    try {
      // For live workflow, start with empty flow and let incremental updates build it
      if (workflowType === 'live') {
        // Initialize empty workshop session for live mode
        setWorkshopSession({
          id: Date.now(),
          startTime: new Date(),
          methodology: 'simple',
          initialTranscript: 'Live workshop session started'
        });
        setAccumulatedTranscript('Live workshop session started');
        setNodes([]);
        setEdges([]);
        setFlowData({ nodes: [], edges: [] });
        setIsGenerating(false);
        return;
      }

      // For upload and manual workflows, generate complete flow
      const response = await authenticatedFetch(`${API_BASE_URL}/generate-flow`, {
        method: 'POST',
        body: {
          transcript: transcript
        }
      });

      if (!response.ok) {
        throw new Error('Flow generation failed');
      }

      const data = await response.json();
      const { nodes: flowNodes, edges: flowEdges } = data;
      
      // Convert to React Flow format
      const reactFlowNodes = flowNodes.map((node, index) => ({
        id: node.id,
        type: node.type === 'decision' ? 'decision' : 
              node.type === 'start' ? 'start' : 
              node.type === 'end' ? 'end' : 
              node.type === 'merge' ? 'merge' : 'default',
        position: { x: 100 + (index % 3) * 300, y: 100 + Math.floor(index / 3) * 150 },
        data: { 
          label: node.label,
          id: node.id,
          logical_id: node.logical_id || '',
          owner: node.owner || 'TBD',
          system: node.system || 'TBD',
          manualOrAutomated: node.manualOrAutomated || 'manual',
          type: node.type || 'default'
        },
        style: {
          background: '#fff',
          border: '1px solid #222',
          borderRadius: 8,
          padding: 10,
          minWidth: 150,
          textAlign: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        },
      }));

      const reactFlowEdges = flowEdges.map((edge, index) => {
        // Check if source is a decision node to add labels
        const sourceNode = flowNodes.find(n => n.id === edge.source);
        const isDecisionNode = sourceNode?.type === 'decision';
        
        return {
        id: `e${index}`,
        source: edge.source,
        target: edge.target,
        type: 'step',
        style: { strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
        // Only add labels for decision node outputs
        label: isDecisionNode ? (edge.condition || 'Yes/No') : '',
        labelStyle: isDecisionNode ? {
          fontSize: 12,
          fontWeight: 'bold',
          fill: '#333'
        } : undefined,
        labelBgStyle: isDecisionNode ? {
          fill: '#fff',
          fillOpacity: 0.8,
          stroke: '#333',
          strokeWidth: 1,
          rx: 4,
          ry: 4
        } : undefined,
        data: isDecisionNode ? {
          onLabelChange: (edgeId, newLabel) => {
            setEdges(prev => prev.map(edge => 
              edge.id === edgeId ? { ...edge, label: newLabel } : edge
            ));
          }
        } : undefined,
        reconnectable: true
      };
      });

      // Apply auto-layout to prevent overlapping
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(reactFlowNodes, reactFlowEdges);
      
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setFlowData({ nodes: layoutedNodes, edges: layoutedEdges });
      saveToHistory(layoutedNodes, layoutedEdges);
      
      // Initialize workshop session for potential further iteration
      setWorkshopSession({
        id: Date.now(),
        startTime: new Date(),
        methodology: 'simple',
        initialTranscript: transcript
      });
      setAccumulatedTranscript(transcript);
    } catch (error) {
      console.error('Flow generation error:', error);
      showErrorMessage(error.response?.data?.detail || 'Failed to generate process flow', setErrorMessage, setShowError);
    } finally {
      setIsGenerating(false);
    }
  };

  // Incremental AI generation for live workshop mode
  const generateIncrementalFlow = React.useCallback(async (newTranscript) => {
      // Get current state from refs for accurate logging
      const currentNodes = currentNodesRef.current.length > 0 ? currentNodesRef.current : nodes;
      const currentEdges = currentEdgesRef.current.length > 0 ? currentEdgesRef.current : edges;
      
      console.log('generateIncrementalFlow called with:', {
        newTranscript,
        flowType,
        isPaused,
        workshopSession: !!workshopSession,
        currentNodes: currentNodes.length,
        currentEdges: currentEdges.length,
        usingRefs: currentNodesRef.current.length > 0
      });

    // Check for duplicate transcript processing
    if (newTranscript.trim() === lastProcessedTranscript.trim()) {
      console.log('Skipping duplicate transcript processing', {
        newTranscript: newTranscript.substring(0, 50) + '...',
        lastProcessed: lastProcessedTranscript.substring(0, 50) + '...'
      });
      setAiProcessingStatus('idle');
      return;
    }
    
    // Prevent overlapping AI calls 
    if (aiProcessingStatus === 'generating') {
      console.log('AI is already generating, skipping to prevent race condition');
      return;
    }
    
    // Set AI processing status to generating to prevent race conditions
    setAiProcessingStatus('generating');

    // Always try to process - let the API handle validation
    console.log('Processing incremental flow request...');

    try {
        // Get current state values to avoid stale closure issues
        const currentFlowType = 'simple';
        const currentSessionId = workshopSession?.id || Date.now();
        const currentAccumulatedTranscript = accumulatedTranscript || 'Live workshop session started';
        
        // Use the current nodes and edges we already retrieved above
        
        console.log('Current state for AI:', {
          nodeCount: currentNodes.length,
          edgeCount: currentEdges.length,
          nodeIds: currentNodes.map(n => n.id),
          flowType: currentFlowType,
          nodeDetails: currentNodes.map(n => ({ id: n.id, label: n.data?.label })),
          usingRefs: currentNodesRef.current.length > 0
        });
      
      // Combine accumulated transcript with new input
      const combinedTranscript = `${currentAccumulatedTranscript}\n\n${newTranscript}`;
      console.log('Combined transcript length:', combinedTranscript.length);
      
      const requestData = {
        transcript: newTranscript,
        accumulatedTranscript: currentAccumulatedTranscript,
        existingFlow: {
          nodes: currentNodes.map(node => ({
            id: node.id,
            label: node.data.label,
            type: node.data.type || 'default',
            position: node.position
          })),
          edges: currentEdges.map(edge => ({
            source: edge.source,
            target: edge.target,
            condition: edge.label
          }))
        },
        // methodology parameter removed
        sessionId: currentSessionId
      };

      console.log('Sending incremental flow request:', requestData);
      
      const response = await authenticatedFetch(`${API_BASE_URL}/generate-incremental-flow`, {
        method: 'POST',
        body: requestData
      });

      if (!response.ok) {
        throw new Error('Incremental flow generation failed');
      }

      const data = await response.json();
      console.log('Incremental flow response:', data);

      const { changes } = data;
      console.log('Changes received:', changes);
      console.log('Changes length:', changes ? changes.length : 'undefined');
      
      // Apply incremental changes
      if (changes && changes.length > 0) {
        console.log('Applying incremental changes:', changes);
        
        // Update existing nodes or add new ones
        const updatedNodes = [...currentNodes];
        const updatedEdges = [...currentEdges];
        
        changes.forEach(change => {
          console.log('Processing change:', change);
          if (change.type === 'add_node') {
            const newNode = {
              id: change.node.id || uuidv4(), // Use AI-provided ID or generate UUID
              type: change.node.type === 'decision' ? 'decision' : 
                    change.node.type === 'start' ? 'start' : 
                    change.node.type === 'end' ? 'end' : 
                    change.node.type === 'merge' ? 'merge' : 'default',
              position: change.node.position || { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
              data: { 
                label: change.node.label,
                id: change.node.id || uuidv4(),
                logical_id: change.node.logical_id || '',
                owner: change.node.owner || 'TBD',
                system: change.node.system || 'TBD',
                manualOrAutomated: change.node.manualOrAutomated || 'manual',
                type: change.node.type || 'default',
                user_modified: false // Track if user has modified this node
              },
              style: {
                background: '#fff',
                border: '1px solid #222',
                borderRadius: 8,
                padding: 10,
                minWidth: 150,
                textAlign: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              },
            };
            updatedNodes.push(newNode);
            console.log('Added new node:', newNode);
          } else if (change.type === 'update_node') {
            const nodeIndex = updatedNodes.findIndex(n => n.id === change.node.id);
            if (nodeIndex !== -1) {
              // Only update if user hasn't manually modified this node
              if (!updatedNodes[nodeIndex].data.user_modified) {
                updatedNodes[nodeIndex].data.label = change.node.label;
                console.log('Updated node (AI):', updatedNodes[nodeIndex]);
              } else {
                console.log('Skipping update - node was user modified:', updatedNodes[nodeIndex].id);
              }
            }
          } else if (change.type === 'add_edge') {
            // Validate that both source and target nodes exist
            const sourceExists = updatedNodes.some(n => n.id === change.edge.source);
            const targetExists = updatedNodes.some(n => n.id === change.edge.target);
            
            if (sourceExists && targetExists) {
              // Check if source is a decision node to add labels
              const sourceNode = updatedNodes.find(n => n.id === change.edge.source);
              const isDecisionNode = sourceNode?.type === 'decision';
              
              const newEdge = {
                id: change.edge.id || uuidv4(), // Use AI-provided ID or generate UUID
                source: change.edge.source,
                target: change.edge.target,
                type: 'step',
                style: { strokeWidth: 2 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 20,
                  height: 20,
                },
                // Only add labels for decision node outputs
                label: isDecisionNode ? (change.edge.condition || 'Yes/No') : '',
                labelStyle: isDecisionNode ? {
                  fontSize: 12,
                  fontWeight: 'bold',
                  fill: '#333'
                } : undefined,
                labelBgStyle: isDecisionNode ? {
                  fill: '#fff',
                  fillOpacity: 0.8,
                  stroke: '#333',
                  strokeWidth: 1,
                  rx: 4,
                  ry: 4
                } : undefined,
                data: isDecisionNode ? {
                  onLabelChange: (edgeId, newLabel) => {
                    setEdges(prev => prev.map(edge => 
                      edge.id === edgeId ? { ...edge, label: newLabel } : edge
                    ));
                  }
                } : undefined,
                reconnectable: true,
              };
              updatedEdges.push(newEdge);
              console.log('Added new edge:', newEdge);
            } else {
              console.warn('Skipping orphan edge - missing nodes:', {
                source: change.edge.source,
                target: change.edge.target,
                sourceExists,
                targetExists
              });
            }
          }
        });
        
        console.log('Updating flow with:', { 
          newNodes: updatedNodes.length, 
          newEdges: updatedEdges.length 
        });
        
        // Apply auto-layout to prevent overlapping
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(updatedNodes, updatedEdges);
        
        console.log('Updating React Flow state with:', {
          nodeCount: layoutedNodes.length,
          edgeCount: layoutedEdges.length,
          nodeIds: layoutedNodes.map(n => n.id)
        });
        
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        setFlowData({ nodes: layoutedNodes, edges: layoutedEdges });
        saveToHistory(layoutedNodes, layoutedEdges);
        
        // Update refs with current state for immediate access
        currentNodesRef.current = layoutedNodes;
        currentEdgesRef.current = layoutedEdges;
        } else {
          console.log('No changes to apply');
          // Reset AI processing status when no changes
          setAiProcessingStatus('idle');
        }
        
        // Update accumulated transcript
        setAccumulatedTranscript(combinedTranscript);
        
        // Update last processed transcript to prevent duplicates
        setLastProcessedTranscript(newTranscript);
        
        // Reset AI processing status
        setAiProcessingStatus('idle');
        
      } catch (error) {
        console.error('Incremental flow generation error:', error);
        console.error('Error details:', error.response?.data);
        // Don't show error to user in live mode, just log it
        
        // Reset AI processing status on error
        setAiProcessingStatus('idle');
      }
    }, [flowType, workshopSession, accumulatedTranscript, nodes, edges, lastProcessedTranscript]);

  const startLiveModeAfterSelection = async () => {
    console.log('Starting live mode with simple flow');
    
    // Set all the state first
    setFlowType('simple');
    setIsLiveMode(true);
    setIsPaused(false);
    
    const newSession = {
      id: Date.now(),
      startTime: new Date(),
      methodology: 'simple',
      initialTranscript: 'Live workshop session started'
    };
    
    setWorkshopSession(newSession);
    setAccumulatedTranscript('Live workshop session started');
    
    // Wait a bit for state to update, then start recording
    setTimeout(async () => {
      await startRecording();
      console.log('Live workshop mode started with microphone');
    }, 100);
  };

  // Microphone recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Use WebM with Opus codec - most reliable for continuous recording
      // WAV is not well supported for streaming recording in browsers
      let selectedMimeType = 'audio/webm;codecs=opus';
      
      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        // Fallback options in order of preference
        const fallbacks = ['audio/webm', 'audio/mp4', 'audio/wav'];
        for (const mimeType of fallbacks) {
          if (MediaRecorder.isTypeSupported(mimeType)) {
            selectedMimeType = mimeType;
            break;
          }
        }
      }
      
      console.log('Using MIME type:', selectedMimeType);
      const recorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
      const chunks = [];

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
            setAudioChunks([...chunks]);
            
            // Don't process individual chunks in live mode - they're fragmented and incomplete
            // Only process when recording stops to get a complete file
            console.log('Audio chunk received, size:', event.data.size);
          }
        };

      recorder.onstop = async () => {
        console.log('Recording stopped, processing audio blob...');
        const audioBlob = new Blob(chunks, { type: selectedMimeType });
        console.log('Created audio blob:', { size: audioBlob.size, type: audioBlob.type });
        await processAudioBlob(audioBlob);
        // Clear chunks immediately after processing to prevent accumulation
        chunks.length = 0;
        setAudioChunks([]);
        console.log('Audio processing completed, chunks cleared');
      };

        // For live mode, we need to periodically stop and restart recording 
        // to get complete audio files instead of fragmented chunks
        console.log('Setting up recording for workflowType:', workflowType);
        if (workflowType === 'live') {
          // Start recording continuously 
          recorder.start();
          console.log('Started recording, setting isRecording to true');
          
          // Set up interval to stop/restart recording every 10 seconds for live processing
          const liveProcessingInterval = setInterval(() => {
            console.log('Live processing interval triggered. Recorder state:', recorder?.state);
            // Check if recorder is actually recording - rely on recorder state, not React state
            if (recorder && recorder.state === 'recording') {
              console.log('Stopping recording for live processing...');
              recorder.stop(); // This will trigger onstop and process the complete audio
              
              // Restart recording after a short delay
              setTimeout(() => {
                console.log('Attempting to restart. Recorder state:', recorder?.state);
                if (recorder && recorder.state === 'inactive') {
                  console.log('Restarting recording for live mode...');
                  try {
                    // Clear any remaining chunks before restarting
                    chunks.length = 0;
                    recorder.start();
                    console.log('Recording restarted successfully. New state:', recorder.state);
                  } catch (error) {
                    console.error('Failed to restart recording:', error);
                  }
                } else {
                  console.log('Skipping restart - recorder state:', recorder?.state);
                }
              }, 1000); // 1 second delay to ensure processing completes
            } else {
              console.log('Skipping stop - recorder state is not recording:', recorder?.state);
            }
          }, 10000); // Every 10 seconds
          
          setProcessingInterval(liveProcessingInterval);
        } else {
          // For upload mode, just record continuously until stopped
          recorder.start();
        }
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
      setRecordingStatus('recording');
      console.log('Recording started with 10-second intervals. States set:', {
        isRecording: true,
        recordingStatus: 'recording'
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      showErrorMessage('Microphone access denied or not available', setErrorMessage, setShowError);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setRecordingStatus('processing');
      console.log('Recording stopped, processing...');
    }
    
    // Clear any processing interval
    if (processingInterval) {
      clearInterval(processingInterval);
      setProcessingInterval(null);
    }
  };

  const processAudioBlob = async (audioBlob, retryCount = 0) => {
    try {
      console.log('Processing audio blob:', { size: audioBlob.size, type: audioBlob.type, retry: retryCount });
      
      // Skip if audio blob is too small (likely empty or corrupted)
      if (audioBlob.size < 5000) {
        console.log('Audio blob too small, skipping:', audioBlob.size);
        return;
      }
      
      // Skip if audio blob is too large (might cause API issues)
      if (audioBlob.size > 25000000) { // 25MB limit
        console.log('Audio blob too large, skipping:', audioBlob.size);
        return;
      }
      
      // Set AI processing status to transcribing
      setAiProcessingStatus('transcribing');
      
      const formData = new FormData();
      
      // Ensure we're sending as WAV format for Whisper compatibility
      let fileName = 'recording.wav';
      let audioBlobToSend = audioBlob;
      
      // If the blob is not WAV, try to convert it
      if (!audioBlob.type.includes('wav')) {
        console.log('Converting audio to WAV format for Whisper compatibility');
        // For now, just change the filename - the backend will handle the conversion
        fileName = 'recording.wav';
      }
      
      formData.append('file', audioBlobToSend, fileName);

      console.log('Sending audio to transcription API:', {
        fileName,
        blobType: audioBlobToSend.type,
        blobSize: audioBlobToSend.size
      });
      
      const response = await authenticatedFetch(`${API_BASE_URL}/transcribe`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      console.log('Transcription response:', data);
      const newTranscript = data.transcript;
      
      if (newTranscript && newTranscript.trim()) {
        console.log('New transcript received:', newTranscript);
        console.log('Current state before handleNewTranscript:', {
          isLiveMode,
          isPaused,
          flowType,
          workshopSession: !!workshopSession
        });
        
        // Filter out obviously non-business content
        const nonBusinessPatterns = [
          /share.*video.*friends/i,
          /subscribe.*channel/i,
          /thank.*watching/i,
          /チャンネル登録/i,
          /ご視聴ありがとう/i,
          /like.*comment/i,
          /don't forget.*like/i,
          /please.*subscribe/i,
          /hit.*like.*button/i,
          /bell.*notification/i,
          /follow.*social/i,
          /share.*social.*media/i
        ];
        
        const isNonBusiness = nonBusinessPatterns.some(pattern => pattern.test(newTranscript));
        if (isNonBusiness) {
          console.log('Skipping non-business content:', newTranscript);
          setAiProcessingStatus('idle');
          return;
        }
        
        // Always process transcript if we have one, regardless of state
        if (newTranscript.trim()) {
          // Update accumulated transcript
          setAccumulatedTranscript(prev => {
            const updated = prev + '\n' + newTranscript;
            console.log('Updated accumulated transcript:', updated);
            return updated;
          });
          
          // Set AI processing status to generating
          setAiProcessingStatus('generating');
          
          console.log('Calling generateIncrementalFlow with:', newTranscript);
          generateIncrementalFlow(newTranscript);
        } else {
          console.log('Skipping incremental flow generation: empty transcript');
          setAiProcessingStatus('idle');
        }
      } else {
        console.log('No transcript received or empty transcript');
        setAiProcessingStatus('idle');
      }
      
      setRecordingStatus('idle');
    } catch (error) {
      console.error('Error processing audio:', error);
      console.error('Error details:', error.response?.data);
      
      // Retry logic for failed transcriptions
      if (retryCount < 2 && error.response?.status === 500) {
        console.log(`Retrying audio processing (attempt ${retryCount + 1}/2)...`);
        setTimeout(() => {
          processAudioBlob(audioBlob, retryCount + 1);
        }, 1000 * (retryCount + 1)); // Exponential backoff
        return;
      }
      
      setRecordingStatus('idle');
      setAiProcessingStatus('idle');
      // Don't show error to user in live mode, just log it
      console.log('Audio processing failed after retries, continuing...');
    }
  };

  // Workshop control functions
  const startLiveMode = async () => {
    // Start live mode directly with simple flow
    await startLiveModeAfterSelection();
  };

  const startLiveModeWithoutRecording = () => {
    setIsLiveMode(true);
    setIsPaused(false);
    
    // Initialize workshop session
    if (!workshopSession) {
      setWorkshopSession({
        id: Date.now(),
        startTime: new Date(),
        methodology: 'simple',
        initialTranscript: 'Live workshop session started (manual mode)'
      });
      setAccumulatedTranscript('Live workshop session started (manual mode)');
    }
    
    console.log('Live workshop mode started without recording - ready for manual input');
  };


  const stopLiveMode = () => {
    if (isRecording) {
      stopRecording();
    }
    setIsLiveMode(false);
    setIsPaused(false);
    setRecordingStatus('idle');
    setAiProcessingStatus('idle');
    console.log('Live workshop mode stopped');
  };

  const togglePause = () => {
    if (isPaused) {
      // Resume - start recording again
      if (isLiveMode) {
        startRecording();
      }
    } else {
      // Pause - stop recording
      if (isRecording) {
        stopRecording();
      }
    }
    setIsPaused(!isPaused);
    console.log('AI generation', isPaused ? 'resumed' : 'paused');
  };

  // Handle new transcript input for live mode
  const handleNewTranscript = React.useCallback((newTranscript) => {
    console.log('handleNewTranscript called:', {
      newTranscript,
      isLiveMode,
      isPaused,
      flowType,
      workshopSession: !!workshopSession
    });
    
    // Always process transcript if we have one
    if (newTranscript.trim()) {
      // Update accumulated transcript
      setAccumulatedTranscript(prev => {
        const updated = prev + '\n' + newTranscript;
        console.log('Updated accumulated transcript:', updated);
        return updated;
      });
      
      console.log('Calling generateIncrementalFlow with:', newTranscript);
      generateIncrementalFlow(newTranscript);
    } else {
      console.log('Skipping incremental flow generation: empty transcript');
    }
  }, [isLiveMode, isPaused, flowType, workshopSession, generateIncrementalFlow]);

  // Expose handleNewTranscript to parent component
  React.useEffect(() => {
    if (typeof onNewTranscript === 'function') {
      onNewTranscript(handleNewTranscript);
    }
  }, [isLiveMode, isPaused, accumulatedTranscript, nodes, edges, flowType, workshopSession]);

  // Cleanup recording on unmount
  React.useEffect(() => {
    return () => {
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
      }
      if (processingInterval) {
        clearInterval(processingInterval);
      }
    };
  }, [mediaRecorder, isRecording, processingInterval]);

  // Simplified toolbar functions
  const handleAddStep = (stepType) => {
    console.log('Adding step:', stepType);
    addSimpleStep(stepType);
  };

  const handleAddDecision = (decisionType) => {
    setShowAddDecisionDropdown(false);
    addSimpleDecision(decisionType);
  };

  const handleAddMerge = () => {
    setShowAddDecisionDropdown(false);
    addMergeNode();
  };

  const addSimpleStep = (stepType) => {
    const newId = `step-${Date.now()}`;
    const logicalId = getNextLogicalId(nodes);
    const newNode = {
      id: newId,
      type: 'default',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: { 
        label: `New ${stepType}`,
        id: newId,
        logical_id: logicalId,
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'default',
        stepType: stepType
      },
    };
    
    // Check if we're in mid-step insertion mode
    if (isMidStepInsertion && targetEdgeForInsertion) {
      const { nodes: newNodes, edges: newEdges } = handleMidStepInsertion(newNode, targetEdgeForInsertion, nodes, edges);
      setNodes(newNodes);
      setEdges(newEdges);
      saveToHistory(newNodes, newEdges);
      setIsMidStepInsertion(false);
      setTargetEdgeForInsertion(null);
    } else {
    setNodes(prev => [...prev, newNode]);
    saveToHistory([...nodes, newNode], edges);
    }
  };

  const addSimpleDecision = (decisionType) => {
    const newId = `decision-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'decision',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: { 
        label: `New Decision`,
        id: newId,
        logical_id: '', // Decision nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'decision',
        decisionType: 'decision'
      },
    };
    
    // Check if we're in mid-step insertion mode
    if (isMidStepInsertion && targetEdgeForInsertion) {
      const { nodes: newNodes, edges: newEdges } = handleMidStepInsertion(newNode, targetEdgeForInsertion, nodes, edges);
      setNodes(newNodes);
      setEdges(newEdges);
      saveToHistory(newNodes, newEdges);
      setIsMidStepInsertion(false);
      setTargetEdgeForInsertion(null);
    } else {
    setNodes(prev => [...prev, newNode]);
    saveToHistory([...nodes, newNode], edges);
    }
  };

  const addMergeNode = () => {
    const newId = `merge-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'merge',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: { 
        label: `Merge`,
        id: newId,
        logical_id: '', // Merge nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'merge',
        nodeType: 'merge'
      },
    };
    
    // Check if we're in mid-step insertion mode
    if (isMidStepInsertion && targetEdgeForInsertion) {
      const { nodes: newNodes, edges: newEdges } = handleMidStepInsertion(newNode, targetEdgeForInsertion, nodes, edges);
      setNodes(newNodes);
      setEdges(newEdges);
      saveToHistory(newNodes, newEdges);
      setIsMidStepInsertion(false);
      setTargetEdgeForInsertion(null);
    } else {
    setNodes(prev => [...prev, newNode]);
    saveToHistory([...nodes, newNode], edges);
    }
  };

  const addStartNode = () => {
    const newId = `start-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'start',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: { 
        label: `Start`,
        id: newId,
        logical_id: '', // Start nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'start',
        nodeType: 'start'
      },
    };
    setNodes(prev => [...prev, newNode]);
    saveToHistory([...nodes, newNode], edges);
  };

  const addEndNode = () => {
    const newId = `end-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'end',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: { 
        label: `End`,
        id: newId,
        logical_id: '', // End nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'end',
        nodeType: 'end'
      },
    };
    setNodes(prev => [...prev, newNode]);
    saveToHistory([...nodes, newNode], edges);
  };

  // Handle edge reconnection - allows users to drag edge endpoints to reconnect them
  const onReconnect = useCallback(
    (oldEdge, newConnection) => {
      console.log('Edge reconnection:', { oldEdge, newConnection });
      
      // Validate the new connection using the same rules as onConnect
      const sourceNode = nodes.find(n => n.id === newConnection.source);
      const targetNode = nodes.find(n => n.id === newConnection.target);
      
      if (!sourceNode || !targetNode) {
        showErrorMessage('Invalid reconnection: source or target node not found', setErrorMessage, setShowError);
        return;
      }
      
      // Apply the same validation rules as in onConnect
      const sourceType = sourceNode.type;
      const targetType = targetNode.type;
      
      // Count existing connections (excluding the old edge being reconnected)
      const otherEdges = edges.filter(e => e.id !== oldEdge.id);
      const sourceOutgoing = otherEdges.filter(e => e.source === newConnection.source).length;
      const targetIncoming = otherEdges.filter(e => e.target === newConnection.target).length;
      
      // Apply connection validation rules
      let isValid = true;
      let errorMessage = '';
      
      if (sourceType === 'start' && sourceOutgoing >= 1) {
        isValid = false;
        errorMessage = 'Start node can only have one outgoing connection';
      } else if (sourceType === 'end') {
        isValid = false;
        errorMessage = 'End node cannot have outgoing connections';
      } else if (sourceType === 'default' && sourceOutgoing >= 1) {
        isValid = false;
        errorMessage = 'Process step can only have one outgoing connection';
      } else if (sourceType === 'decision' && sourceOutgoing >= 3) {
        isValid = false;
        errorMessage = 'Decision node can have maximum 3 outgoing connections';
      }
      
      if (targetType === 'start') {
        isValid = false;
        errorMessage = 'Start node cannot have incoming connections';
      } else if (targetType === 'default' && targetIncoming >= 1) {
        isValid = false;
        errorMessage = 'Process step can only have one incoming connection';
      } else if (targetType === 'decision' && targetIncoming >= 1) {
        isValid = false;
        errorMessage = 'Decision node can only have one incoming connection';
      }
      
      if (!isValid) {
        showErrorMessage(errorMessage, setErrorMessage, setShowError);
        return;
      }
      
      // If validation passes, update the edges
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
      
      // After reconnection, renumber nodes based on new flow sequence
      setTimeout(() => {
        const currentNodes = nodes;
        const currentEdges = edges;
        const renumberedNodes = renumberByFlowSequence(currentNodes, currentEdges);
        setNodes(renumberedNodes);
        saveToHistory(renumberedNodes, currentEdges);
      }, 100);
    },
    [nodes, edges, setErrorMessage, setShowError]
  );

  const onConnect = useCallback(
    (params) => {
      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);
      
      if (!sourceNode || !targetNode) return;
      
      // Validate connection rules
      const sourceType = sourceNode.type;
      const targetType = targetNode.type;
      
      // Count existing connections
      const sourceOutgoing = edges.filter(e => e.source === params.source).length;
      const targetIncoming = edges.filter(e => e.target === params.target).length;
      
      // Check for double entry (same anchor point)
      const existingConnection = edges.find(e => 
        e.source === params.source && e.target === params.target &&
        e.sourceHandle === params.sourceHandle && e.targetHandle === params.targetHandle
      );
      
      if (existingConnection) {
        showErrorMessage('Connection already exists at this anchor point', setErrorMessage, setShowError);
        return;
      }
      
      // Check for duplicate connector usage (same handle used twice)
      const sourceHandleUsed = edges.some(e => 
        e.source === params.source && e.sourceHandle === params.sourceHandle
      );
      const targetHandleUsed = edges.some(e => 
        e.target === params.target && e.targetHandle === params.targetHandle
      );
      
      if (sourceHandleUsed) {
        showErrorMessage('This connector point is already in use', setErrorMessage, setShowError);
        return;
      }
      
      if (targetHandleUsed) {
        showErrorMessage('This connector point is already in use', setErrorMessage, setShowError);
        return;
      }
      
      // Validate connection rules
      let isValid = true;
      let errorMessage = '';
      
      if (sourceType === 'start') {
        // Start node: no input, exactly 1 output
        if (targetIncoming > 0) {
          isValid = false;
          errorMessage = 'Start node cannot have incoming connections';
        }
        if (sourceOutgoing >= 1) {
          isValid = false;
          errorMessage = 'Start node can only have one outgoing connection';
        }
      } else if (sourceType === 'end') {
        // End node: no output
        isValid = false;
        errorMessage = 'End node cannot have outgoing connections';
      } else if (sourceType === 'default') {
        // Standard process node: exactly 1 input + 1 output
        if (sourceOutgoing >= 1) {
          isValid = false;
          errorMessage = 'Process step can only have one outgoing connection';
        }
      } else if (sourceType === 'decision') {
        // Decision node: exactly 1 input + ≥2 outputs (max 3 outputs using right, top, bottom)
        if (sourceOutgoing >= 3) {
          isValid = false;
          errorMessage = 'Decision node can have maximum 3 outgoing connections';
        }
      } else if (sourceType === 'merge') {
        // Merge node: fully bidirectional - no outgoing limit
        // Allow unlimited outgoing connections for maximum flexibility
      }
      
      if (targetType === 'start') {
        // Start node: no input
        isValid = false;
        errorMessage = 'Start node cannot have incoming connections';
      } else if (targetType === 'end') {
        // End node: ≥1 input (no limit)
        // No validation needed
      } else if (targetType === 'default') {
        // Standard process node: exactly 1 input + 1 output
        if (targetIncoming >= 1) {
          isValid = false;
          errorMessage = 'Process step can only have one incoming connection';
        }
      } else if (targetType === 'decision') {
        // Decision node: exactly 1 input + ≥2 outputs
        if (targetIncoming >= 1) {
          isValid = false;
          errorMessage = 'Decision node can only have one incoming connection';
        }
      } else if (targetType === 'merge') {
        // Merge node: fully bidirectional - no incoming limit
        // Allow unlimited incoming connections for maximum flexibility
      }
      
      if (!isValid) {
        showErrorMessage(errorMessage, setErrorMessage, setShowError);
        return;
      }
      
      // Check if source is a decision node to add labels
      const isDecisionNode = sourceType === 'decision';
      
      const newEdges = addEdge({
        ...params,
        type: 'step',
        style: { strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
        reconnectable: true,
        // Only add labels for decision node outputs
        label: isDecisionNode ? (params.targetHandle === 'top' ? 'Yes' : 'No') : '',
        labelStyle: isDecisionNode ? {
          fontSize: 12,
          fontWeight: 'bold',
          fill: '#333'
        } : undefined,
        labelBgStyle: isDecisionNode ? {
          fill: '#fff',
          fillOpacity: 0.8,
          stroke: '#333',
          strokeWidth: 1,
          rx: 4,
          ry: 4
        } : undefined,
        data: isDecisionNode ? {
          onLabelChange: (edgeId, newLabel) => {
            setEdges(prev => prev.map(edge => 
              edge.id === edgeId ? { ...edge, label: newLabel } : edge
            ));
          }
        } : undefined,
      }, edges);
      
      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);
      
      setEdges(newEdges);
      setNodes(renumberedNodes);
      saveToHistory(renumberedNodes, newEdges);
    },
    [nodes, edges, setErrorMessage, setShowError]
  );

  const downloadJSON = () => {
    if (!flowData) {
      showErrorMessage('No flow data to download', setErrorMessage, setShowError);
      return;
    }

    const dataStr = JSON.stringify(flowData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'process-flow.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const downloadPNG = async () => {
    if (!flowRef.current) {
      showErrorMessage('No flow to export', setErrorMessage, setShowError);
      return;
    }

    try {
      const dataUrl = await htmlToImage.toPng(flowRef.current, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: {
          width: '100%',
          height: '100%',
        },
      });

      const link = document.createElement('a');
      link.download = 'process-flow.png';
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('PNG export error:', error);
      showErrorMessage('Failed to export PNG', setErrorMessage, setShowError);
    }
  };

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
  };

  // Edge label editing functions
  const handleEdgeLabelSave = () => {
    if (selectedEdge) {
      const newEdges = edges.map((edge) =>
        edge.id === selectedEdge.id
          ? { ...edge, label: edgeLabel }
          : edge
      );
      setEdges(newEdges);
      saveToHistory(nodes, newEdges);
    }
    setIsEditingEdge(false);
    setSelectedEdge(null);
    setEdgeLabel('');
  };

  const handleEdgeLabelCancel = () => {
    setIsEditingEdge(false);
    setSelectedEdge(null);
    setEdgeLabel('');
  };

  const handleEdgeDelete = () => {
    if (selectedEdge) {
      const newEdges = edges.filter((edge) => edge.id !== selectedEdge.id);
      
      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);
      
      setEdges(newEdges);
      setNodes(renumberedNodes);
      saveToHistory(renumberedNodes, newEdges);
    }
    setIsEditingEdge(false);
    setSelectedEdge(null);
    setEdgeLabel('');
  };



  // Tool functions
  const addTaskNode = () => {
    const newNodeId = `task-${Date.now()}`;
    const logicalId = getNextLogicalId(nodes);
    const newNode = {
      id: newNodeId,
      type: 'default',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: { 
        label: 'New Task',
        id: newNodeId,
        logical_id: logicalId,
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'default'
      }
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    saveToHistory(newNodes, edges);
  };

  const addGatewayNode = () => {
    const newNodeId = `gateway-${Date.now()}`;
    const logicalId = getNextLogicalId(nodes);
    const newNode = {
      id: newNodeId,
      type: 'decision',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: { 
        label: 'Decision?',
        id: newNodeId,
        logical_id: logicalId,
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'decision'
      }
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    saveToHistory(newNodes, edges);
  };

  const handleNodeClick = (event, node) => {
    if (selectedTool === 'delete') {
      const newNodes = nodes.filter((n) => n.id !== node.id);
      const newEdges = edges.filter((e) => e.source !== node.id && e.target !== node.id);
      
      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(newNodes, newEdges);
      
      setNodes(renumberedNodes);
      setEdges(newEdges);
      saveToHistory(renumberedNodes, newEdges);
    } else if (selectedTool === 'select') {
      // Clear edge selection when selecting nodes
      setSelectedEdges([]);
    }
  };

  const handleEdgeClick = (event, edge) => {
    if (selectedTool === 'delete') {
      const newEdges = edges.filter((e) => e.id !== edge.id);
      
      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);
      
      setEdges(newEdges);
      setNodes(renumberedNodes);
      saveToHistory(renumberedNodes, newEdges);
    } else if (selectedTool !== 'select') {
      // If we have a tool selected (not select), set up for mid-step insertion
      setTargetEdgeForInsertion(edge);
      setIsMidStepInsertion(true);
    } else {
      // Handle edge selection and editing
      if (event.ctrlKey || event.metaKey) {
        // Multi-select with Ctrl/Cmd
        setSelectedEdges(prev => 
          prev.includes(edge.id) 
            ? prev.filter(id => id !== edge.id)
            : [...prev, edge.id]
        );
        // Clear node selection when selecting edges
        setNodes(prev => prev.map(node => ({ ...node, selected: false })));
      } else {
        // Single select
        setSelectedEdges([edge.id]);
        // Clear node selection when selecting edges
        setNodes(prev => prev.map(node => ({ ...node, selected: false })));
        
        // Check if this is a decision connector with a label
        const sourceNode = nodes.find(n => n.id === edge.source);
        if (sourceNode?.type === 'decision' && edge.label) {
          setSelectedEdge(edge);
          setEdgeLabel(edge.label || '');
          setIsEditingEdge(true);
        }
      }
    }
  };

  const handleEdgeMouseEnter = (event, edge) => {
    if (selectedTool !== 'select') {
      setTargetEdgeForInsertion(edge);
      setIsMidStepInsertion(true);
      // Add visual feedback
      event.target.style.stroke = '#ff6b6b';
      event.target.style.strokeWidth = '4';
    }
  };

  const handleEdgeMouseLeave = (event, edge) => {
    if (selectedTool !== 'select') {
      setTargetEdgeForInsertion(null);
      setIsMidStepInsertion(false);
      // Remove visual feedback
      event.target.style.stroke = '#007bff';
      event.target.style.strokeWidth = '2';
    }
  };

  const handleSaveFlow = async () => {
    if (onSaveFlow && processId) {
      const flowData = {
        nodes: nodes,
        edges: edges
      };
      await onSaveFlow(flowData, processId, processName);
    }
  };

  const exportOptions = [
    { key: 'png', label: 'Export as PNG', action: downloadPNG },
    { key: 'json', label: 'Export as JSON', action: downloadJSON },
    { key: 'svg', label: 'Export as SVG', action: () => console.log('SVG export - to be implemented') },
  ];

  // Multi-select operations
  const deleteSelectedNodes = () => {
    const selectedNodeIds = nodes.filter(node => node.selected).map(node => node.id);
    if (selectedNodeIds.length > 0) {
      const newNodes = nodes.filter(node => !node.selected);
      const newEdges = edges.filter(edge => 
        !selectedNodeIds.includes(edge.source) && !selectedNodeIds.includes(edge.target)
      );
      
      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(newNodes, newEdges);
      
      setNodes(renumberedNodes);
      setEdges(newEdges);
      saveToHistory(renumberedNodes, newEdges);
    }
  };

  const deleteSelectedEdges = () => {
    if (selectedEdges.length > 0) {
      const newEdges = edges.filter(edge => !selectedEdges.includes(edge.id));
      
      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);
      
      setEdges(newEdges);
      setNodes(renumberedNodes);
      setSelectedEdges([]);
      saveToHistory(renumberedNodes, newEdges);
    }
  };

  // Unified delete function for both nodes and edges
  const deleteSelected = () => {
    if (selectedEdges.length > 0) {
      deleteSelectedEdges();
    } else {
      deleteSelectedNodes();
    }
  };

  // Handle keyboard shortcuts and multi-select
  React.useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Delete' && selectedTool === 'select') {
        deleteSelected();
      }
    };

    const handleMouseDown = (event) => {
      // Only allow multi-select within the ReactFlow canvas
      const isWithinCanvas = event.target.closest('.react-flow');
      if (event.shiftKey && isWithinCanvas && selectedTool === 'select') {
        // Allow ReactFlow to handle the multi-select
        return;
      } else if (event.shiftKey && !isWithinCanvas) {
        // Prevent multi-select outside the canvas
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown, true);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [nodes, selectedTool]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportDropdown && !event.target.closest('.dropdown-container')) {
        setShowExportDropdown(false);
      }
      if (showAddDecisionDropdown && !event.target.closest('.dropdown-container')) {
        setShowAddDecisionDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportDropdown, showAddDecisionDropdown]);

  return (
    <div className={`flow-section ${isMaximized ? 'maximized' : ''}`}>

      <div style={{ padding: '1rem', borderBottom: '1px solid #e0e0e0', background: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Left side: Process Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Folder Icon Button */}
            <button
              className="header-button"
              onClick={() => {
                if (onChangeProcess) {
                  onChangeProcess();
                }
              }}
              title="Change Process"
              style={{
                background: 'white',
                border: '1px solid #1e3a8a',
                color: '#1e3a8a',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '36px',
                height: '36px'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#eff6ff';
                e.target.style.borderColor = '#1e40af';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'white';
                e.target.style.borderColor = '#1e3a8a';
              }}
            >
              {/* Folder Icon SVG */}
              <svg 
                width="18" 
                height="18" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            
            <div style={{ 
              fontSize: '1.25rem', 
              fontWeight: '600', 
              color: '#1e3a8a',
              minWidth: 'fit-content'
            }}>
              {selectedProcess?.name || 'Process'}
            </div>
            {workshopSession && (
              <div style={{ fontSize: '0.75rem', color: '#666', marginLeft: '1rem' }}>
                Workshop Session: {workshopSession.id} | Started: {workshopSession.startTime.toLocaleTimeString()}
                {isLiveMode && (
                  <div 
                    className={recordingStatus === 'recording' ? 'recording-status' : ''}
                    style={{ 
                      marginTop: '0.25rem',
                      color: recordingStatus === 'recording' ? '#dc3545' : 
                             recordingStatus === 'processing' ? '#ffc107' : '#28a745',
                      fontWeight: 'bold'
                    }}
                  >
                    {recordingStatus === 'recording' && <span className="recording-indicator"></span>}
                    {recordingStatus === 'recording' ? 'RECORDING...' : 
                     recordingStatus === 'processing' ? 'PROCESSING...' : 'READY'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right side: Action Buttons */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>

            {/* Live Mode Status */}
            {workflowType === 'live' && isLiveMode && (
              <div style={{ 
                fontSize: '0.8rem', 
                color: isPaused ? '#ffc107' : '#28a745',
                fontWeight: 'bold',
                marginRight: '1rem'
              }}>
                {isPaused ? 'PAUSED' : 'LIVE'}
              </div>
            )}
            
            {/* Speak Button */}
            {onStartRecording && (
              !isRecording ? (
                <button 
                  className="header-button"
                  onClick={onStartRecording}
                  disabled={isWriteMode}
                  style={{
                    background: isWriteMode ? '#f3f4f6' : 'white',
                    border: `1px solid ${isWriteMode ? '#9ca3af' : '#1e3a8a'}`,
                    color: isWriteMode ? '#9ca3af' : '#1e3a8a',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: isWriteMode ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: isWriteMode ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (!isWriteMode) {
                      e.target.style.background = '#eff6ff';
                      e.target.style.borderColor = '#1e40af';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isWriteMode) {
                      e.target.style.background = 'white';
                      e.target.style.borderColor = '#1e3a8a';
                    }
                  }}
                >
                  Speak
                </button>
              ) : (
                <>
                  <button 
                    className="header-button"
                    onClick={onPauseRecording}
                    style={{
                      background: isPaused ? '#ffc107' : '#dc3545',
                      color: 'white',
                      border: `1px solid ${isPaused ? '#ffc107' : '#dc3545'}`,
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button 
                    className="header-button"
                    onClick={onStopRecording}
                    style={{
                      background: '#6c757d',
                      color: 'white',
                      border: '1px solid #6c757d',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Stop
                  </button>
                </>
              )
            )}

            {/* Write Button */}
            {onStartWriting && (
              !isWriteMode ? (
                <button 
                  className="header-button"
                  onClick={onStartWriting}
                  disabled={isRecording}
                  style={{
                    background: isRecording ? '#f3f4f6' : 'white',
                    border: `1px solid ${isRecording ? '#9ca3af' : '#1e3a8a'}`,
                    color: isRecording ? '#9ca3af' : '#1e3a8a',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: isRecording ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: isRecording ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (!isRecording) {
                      e.target.style.background = '#eff6ff';
                      e.target.style.borderColor = '#1e40af';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isRecording) {
                      e.target.style.background = 'white';
                      e.target.style.borderColor = '#1e3a8a';
                    }
                  }}
                >
                  Write
                </button>
              ) : (
                <button 
                  className="header-button"
                  onClick={onStopWriting}
                  style={{
                    background: '#6c757d',
                    color: 'white',
                    border: '1px solid #6c757d',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Close Chat
                </button>
              )
            )}

            {/* Upload Document Button */}
            {onUploadDocument && (
              <button 
                className="header-button"
                onClick={onUploadDocument}
                disabled={isRecording || isWriteMode}
                style={{
                  background: (isRecording || isWriteMode) ? '#f3f4f6' : 'white',
                  border: `1px solid ${(isRecording || isWriteMode) ? '#9ca3af' : '#1e3a8a'}`,
                  color: (isRecording || isWriteMode) ? '#9ca3af' : '#1e3a8a',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: (isRecording || isWriteMode) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: (isRecording || isWriteMode) ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!isRecording && !isWriteMode) {
                    e.target.style.background = '#eff6ff';
                    e.target.style.borderColor = '#1e40af';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isRecording && !isWriteMode) {
                    e.target.style.background = 'white';
                    e.target.style.borderColor = '#1e3a8a';
                  }
                }}
              >
                Upload Document
              </button>
            )}

            {/* Save & Finalize Button */}
            {onSaveFinalize && (
              <button 
                className="header-button"
                onClick={() => {
                  // Pass current nodes and edges to save handler
                  if (nodes.length > 0) {
                    onSaveFinalize({ nodes, edges });
                  }
                }}
                disabled={nodes.length === 0}
                style={{
                  background: nodes.length > 0 ? '#28a745' : '#f3f4f6',
                  color: nodes.length > 0 ? 'white' : '#9ca3af',
                  border: `1px solid ${nodes.length > 0 ? '#28a745' : '#9ca3af'}`,
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: nodes.length > 0 ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s ease',
                  opacity: nodes.length > 0 ? 1 : 0.5
                }}
                onMouseEnter={(e) => {
                  if (nodes.length > 0) {
                    e.target.style.background = '#218838';
                  }
                }}
                onMouseLeave={(e) => {
                  if (nodes.length > 0) {
                    e.target.style.background = '#28a745';
                  }
                }}
              >
                Save
              </button>
            )}
          </div>
        </div>
        <div className="controls">
          {/* Generate Flow Button - Only for upload and manual workflows */}
          {(workflowType === 'upload' || workflowType === 'manual' || workflowType === 'voice') && transcript && (
            <button
              className="control-button"
              onClick={generateFlow}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <div className="loading">
                  <div className="spinner"></div>
                  Generating Flow...
                </div>
              ) : (
                'Generate Flow'
              )}
            </button>
          )}

          {/* Live Mode Controls */}
          {workflowType === 'live' && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {!isLiveMode ? (
                <button
                  className="control-button"
                  onClick={startLiveMode}
                  style={{ 
                    background: '#28a745', 
                    color: 'white',
                    border: '1px solid #28a745'
                  }}
                >
                  Start Live Session
                </button>
              ) : (
                <>
                  <button
                    className="control-button"
                    onClick={togglePause}
                    style={{ 
                      background: isPaused ? '#ffc107' : '#dc3545',
                      color: 'white',
                      border: `1px solid ${isPaused ? '#ffc107' : '#dc3545'}`
                    }}
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="control-button"
                    onClick={stopLiveMode}
                    style={{ 
                      background: '#6c757d', 
                      color: 'white',
                      border: '1px solid #6c757d'
                    }}
                  >
                    Stop
                  </button>
                </>
              )}
              
              {/* AI Processing Status Indicator */}
              {aiProcessingStatus !== 'idle' && (
                <div className="ai-processing-indicator" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  color: '#495057'
                }}>
                  <div className="ai-spinner" style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid #e3e3e3',
                    borderTop: '2px solid #007bff',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                  <span>
                    {aiProcessingStatus === 'transcribing' ? 'Transcribing audio...' : 
                     aiProcessingStatus === 'generating' ? 'Generating flow...' : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {flowData && (
            <span className="flow-status">
              Process flow generated ({nodes.length} nodes, {edges.length} connections)
            </span>
          )}
        </div>
      </div>
      
      <div className={`flow-container ${isMaximized ? 'maximized' : ''}`} ref={flowRef}>
        {/* Visio-style Toolbar */}
        <div className="visio-toolbar">
          <div className="toolbar-group">
              <button 
                className={`toolbar-icon ${selectedTool === 'select' ? 'active' : ''}`}
                onClick={() => setSelectedTool('select')}
                title="Select Tool - Click and drag to move nodes"
              >
                <div className="cursor-icon"></div>
              </button>
            
            {/* Process Step Button */}
            <button 
              className="toolbar-icon"
              onClick={() => handleAddStep('Process Step')}
              title="Process Step - Single action in the process (1 in, 1 out)"
            >
              <span className="icon">▭</span>
            </button>
            
            {/* Contextual Add Decision Button */}
            <div className="dropdown-container">
              <button 
                className={`toolbar-icon dropdown-trigger ${selectedTool === 'addDecision' ? 'active' : ''}`}
                onClick={() => setShowAddDecisionDropdown(!showAddDecisionDropdown)}
                title="Add Decision - Choose decision type based on methodology"
              >
                <span className="icon">◆</span>
                <span className="dropdown-arrow">▼</span>
              </button>
              
              {showAddDecisionDropdown && (
                <div 
                  className="dropdown-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button 
                    className="dropdown-item" 
                    onClick={() => handleAddDecision('Decision')}
                    title="Conditional branching (1 in, 2+ out)"
                  >
                    Decision Point
                  </button>
                  <button 
                    className="dropdown-item" 
                    onClick={() => handleAddMerge()}
                    title="Merge branches back into single flow (2+ in, 1 out)"
                  >
                    Merge Node
                  </button>
                </div>
              )}
            </div>
            
            {/* Start Node Button */}
            <button 
              className="toolbar-icon"
              onClick={addStartNode}
              title="Start Event - No incoming connectors"
            >
              <span className="icon">○</span>
            </button>
            
            {/* End Node Button */}
            <button 
              className="toolbar-icon"
              onClick={addEndNode}
              title="End Event - No outgoing connectors"
            >
              <span className="icon">●</span>
            </button>
            

            
            {/* Duplicate Button */}
            <button 
              className="toolbar-icon"
              onClick={() => {
                const selectedNodes = nodes.filter(node => node.selected);
                if (selectedNodes.length === 0) return;
                
                // Create duplicates of selected nodes with offset position
                const duplicatedNodes = selectedNodes.map(node => ({
                  ...node,
                  id: `${node.type}-${Date.now()}-${Math.random()}`,
                  position: {
                    x: node.position.x + 50,
                    y: node.position.y + 50
                  },
                  selected: true,
                  data: {
                    ...node.data,
                    logical_id: node.data.logical_id ? `${node.data.logical_id}-copy` : undefined
                  }
                }));
                
                // Deselect original nodes
                const updatedNodes = nodes.map(node => ({ ...node, selected: false }));
                
                // Add duplicated nodes
                const newNodes = [...updatedNodes, ...duplicatedNodes];
                setNodes(newNodes);
                saveToHistory(newNodes, edges);
              }}
              disabled={!nodes.some(node => node.selected)}
              title="Duplicate Selected - Duplicate selected nodes"
            >
              <span className="icon">⎘</span>
            </button>
            
            <button 
              className="toolbar-icon"
              onClick={deleteSelected}
              disabled={!nodes.some(node => node.selected) && selectedEdges.length === 0}
              title={`Delete Selected - ${selectedEdges.length > 0 ? `${selectedEdges.length} connector(s)` : 'nodes'} selected`}
            >
              <span className="icon">✕</span>
            </button>
            
            <button 
              className="toolbar-icon"
              onClick={() => {
                const newNodes = nodes.map(node => ({ ...node, selected: true }));
                setNodes(newNodes);
                saveToHistory(newNodes, edges);
              }}
              disabled={nodes.length === 0}
              title="Select All - Select all nodes"
            >
              <span className="icon">☰</span>
            </button>
          </div>
          
          <div className="toolbar-group">
            <button 
              className="toolbar-icon"
              onClick={undo}
              disabled={historyIndex <= 0}
              title="Undo - Undo last action"
            >
              <span className="icon">↶</span>
            </button>
            
            <button 
              className="toolbar-icon"
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              title="Redo - Redo last undone action"
            >
              <span className="icon">↷</span>
            </button>
          </div>

          <div className="toolbar-group export-group">
            <div className="dropdown-container">
              <button 
                className="toolbar-icon dropdown-trigger"
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                title="Export Options - Choose export format"
              >
                <span className="icon">⇪</span>
                <span className="dropdown-arrow">▼</span>
              </button>
              
              {showExportDropdown && (
                <div className="dropdown-menu">
                  <button className="dropdown-item" onClick={() => {
                    downloadPNG();
                    setShowExportDropdown(false);
                  }}>
                    Export as PNG
                  </button>
                  <button className="dropdown-item" onClick={() => {
                    downloadJSON();
                    setShowExportDropdown(false);
                  }}>
                    Export as JSON
                  </button>
                  <button className="dropdown-item" onClick={() => {
                    alert('SVG export coming soon!');
                    setShowExportDropdown(false);
                  }}>
                    Export as SVG
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Maximize/Minimize Button */}
          <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
            <button 
              className="toolbar-icon"
              onClick={toggleMaximize}
              title={isMaximized ? "Exit Fullscreen" : "Fullscreen View"}
            >
              <span className="icon">{isMaximized ? '⊡' : '⊞'}</span>
            </button>
          </div>
        </div>


        {/* Edge Editing Modal */}
        {isEditingEdge && (
          <div className="edge-edit-modal">
            <div className="edge-edit-content">
              <h3>Edit Connection Label</h3>
              <div className="edge-edit-form">
                <label>
                  Connection Label:
                  <input
                    type="text"
                    value={edgeLabel}
                    onChange={(e) => setEdgeLabel(e.target.value)}
                    placeholder="Enter connection label..."
                    autoFocus
                  />
                </label>
                <div className="edge-edit-buttons">
                  <button className="save-button" onClick={handleEdgeLabelSave}>
                    Save
                  </button>
                  <button className="cancel-button" onClick={handleEdgeLabelCancel}>
                    Cancel
                  </button>
                  <button className="delete-button" onClick={handleEdgeDelete}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mid-step Insertion Indicator */}
        {isMidStepInsertion && targetEdgeForInsertion && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#ff6b6b',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 'bold',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}>
            Click a node type to insert it here
          </div>
        )}

        {/* Error Message Display */}
        {showError && errorMessage && (
          <div style={{
            position: 'absolute',
            top: '60px',
            right: '20px',
            background: '#dc3545',
            color: 'white',
            padding: '12px 16px',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            zIndex: 1001,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            maxWidth: '300px',
            opacity: showError ? 1 : 0,
            transform: showError ? 'translateY(0)' : 'translateY(-10px)',
            transition: 'all 0.3s ease-in-out',
            border: '1px solid #c82333'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {nodes.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
            fontSize: '16px',
            textAlign: 'center',
            padding: '2rem',
            minHeight: '400px'
          }}>
            {isProcessing ? (
              <>
                <div className="spinner" style={{ 
                  margin: '0 auto 1rem',
                  width: '48px',
                  height: '48px',
                  border: '4px solid #f3f3f3',
                  borderTop: '4px solid #007bff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                <div style={{ marginBottom: '0.5rem', fontWeight: '500', fontSize: '18px' }}>
                  {processingMessage || 'Processing...'}
                </div>
                <div style={{ fontSize: '14px', opacity: 0.7 }}>
                  This may take 30-60 seconds for document processing
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '48px', marginBottom: '1rem', opacity: 0.5 }}>📊</div>
                <div style={{ marginBottom: '0.5rem', fontWeight: '500' }}>No Process Flow Yet</div>
                <div style={{ fontSize: '14px', opacity: 0.7 }}>
                  {workflowType === 'document' ? 'Upload a document to generate a flow' :
                   workflowType === 'voice' ? 'Speak to generate a flow' :
                   'Add process steps manually or upload a document'}
                </div>
              </>
            )}
            {flowData && (
              <div style={{ 
                marginTop: '1rem', 
                padding: '0.5rem', 
                background: '#fff3cd', 
                border: '1px solid #ffeaa7', 
                borderRadius: '4px',
                fontSize: '12px',
                color: '#856404'
              }}>
                ⚠️ Flow data available but not rendering. Check console for details.
              </div>
            )}
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', minHeight: '500px' }}>
            <ReactFlow
              key={`flow-${nodes.length}-${edges.length}`}
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onEdgeClick={handleEdgeClick}
              onNodeClick={handleNodeClick}
              onEdgeMouseEnter={handleEdgeMouseEnter}
              onEdgeMouseLeave={handleEdgeMouseLeave}
              fitView
              attributionPosition="bottom-left"
              selectNodesOnDrag={selectedTool === 'select'}
              multiSelectionKeyCode={null}
              deleteKeyCode="Delete"
              nodeTypes={nodeTypes}
              defaultEdgeOptions={{
                type: 'step',
                style: { strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 20,
                height: 20,
              },
                reconnectable: true,
              }}
            >
              <Controls />
              <MiniMap />
              <Background variant="dots" gap={12} size={1} />
            </ReactFlow>
          </div>
        )}
      </div>

      {/* Minimized Chat Bar */}
      {isWriteMode && isChatMinimized && (
        <div 
          onClick={onMinimizeChat}
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '300px',
            padding: '16px',
            background: '#1e3a8a',
            color: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            cursor: 'pointer',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: '1px solid #1e40af'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>✍️</span>
            <span style={{ fontWeight: '600' }}>Describe Your Process</span>
          </div>
          <span style={{ fontSize: '20px' }}>▲</span>
        </div>
      )}

      {/* Write Mode Chat Interface */}
      {isWriteMode && !isChatMinimized && (
        <div style={{
          position: 'fixed',
          top: '130px',
          bottom: '20px',
          right: '20px',
          width: '650px',
          maxHeight: 'calc(100vh - 150px)',
          background: 'white',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 99999,
          border: '1px solid #e5e7eb',
          isolation: 'isolate'
        }}>
          {/* Chat Header */}
          <div style={{
            padding: '16px',
            borderBottom: '1px solid #e5e7eb',
            background: '#1e3a8a',
            color: 'white',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>✍️ Describe Your Process</h3>
            <button
              onClick={onMinimizeChat}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'white',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '0 6px',
                lineHeight: '1',
                fontWeight: 'bold'
              }}
              title="Minimize Chat"
            >
              —
            </button>
          </div>

          {/* Chat Messages Area */}
          <div style={{
            flex: 1,
            padding: '16px',
            overflowY: 'auto',
            background: '#f9fafb',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {/* Welcome message */}
            {chatHistory.length === 0 && (
              <div style={{
                padding: '12px',
                background: '#eff6ff',
                borderRadius: '8px',
                border: '1px solid #bfdbfe',
                fontSize: '14px',
                color: '#1e40af',
              }}>
                💡 Describe your process step by step. I'll generate a flow diagram in real-time!
              </div>
            )}
            
            {/* Chat history */}
            {chatHistory && chatHistory.map((message, index) => (
              <div 
                key={index}
                style={{
                  display: 'flex',
                  flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  gap: '8px'
                }}
              >
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: message.role === 'user' ? '#1e3a8a' : '#10b981',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  flexShrink: 0
                }}>
                  {message.role === 'user' ? '👤' : '🤖'}
                </div>
                <div style={{
                  maxWidth: '75%',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  background: message.role === 'user' ? '#1e3a8a' : '#e5e7eb',
                  color: message.role === 'user' ? 'white' : '#1f2937',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  wordWrap: 'break-word',
                  whiteSpace: 'pre-line'
                }}>
                  {message.content.split(/(\*\*.*?\*\*)/).map((part, i) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return <strong key={i}>{part.slice(2, -2)}</strong>;
                    }
                    return part;
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Input Area */}
          <div style={{
            padding: '16px',
            borderTop: '1px solid #e5e7eb',
            background: 'white',
            borderBottomLeftRadius: '12px',
            borderBottomRightRadius: '12px'
          }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <textarea
                  value={writeMessage}
                  onChange={(e) => onWriteMessageChange(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (isClarificationMode) {
                        // In clarification mode, check if user typed "yes" or clarification
                        if (writeMessage.toLowerCase().trim() === 'yes') {
                          onConfirmClarification();
                        } else {
                          onSendMessage(); // Treat as new clarification request
                        }
                      } else {
                        onSendMessage();
                      }
                    }
                  }}
                  placeholder={
                    isClarificationMode 
                      ? 'Type "yes" to confirm, or clarify any adjustments needed...'
                      : 'Describe the next steps... (Press Enter to send, Shift+Enter for new line)'
                  }
                  disabled={isProcessing}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#1e3a8a'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>
                    {isProcessing ? 'Processing...' : 
                     isClarificationMode ? 'Waiting for your confirmation' : 'Type your message'}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isClarificationMode && pendingClarification && (
                      <button
                        onClick={onConfirmClarification}
                        disabled={isProcessing}
                        style={{
                          padding: '8px 20px',
                          background: isProcessing ? '#9ca3af' : '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '500',
                          cursor: isProcessing ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {isProcessing ? '⏳ Generating...' : '✅ Confirm & Generate'}
                      </button>
                    )}
                    <button
                      onClick={onSendMessage}
                      disabled={!writeMessage.trim() || isProcessing}
                      style={{
                        padding: '8px 24px',
                        background: (!writeMessage.trim() || isProcessing) ? '#9ca3af' : '#1e3a8a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: (!writeMessage.trim() || isProcessing) ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {isProcessing ? '⏳ Processing...' : 
                       isClarificationMode ? '📝 Clarify' : '📤 Send'}
                    </button>
                  </div>
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FlowChart;

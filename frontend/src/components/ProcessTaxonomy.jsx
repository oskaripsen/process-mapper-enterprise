import React, { useState, useEffect } from 'react';
import TemplateSelector from './TemplateSelector';
import ProcessFlowViewer from './ProcessFlowViewer';
import { API_BASE_URL, authenticatedFetch, getCurrentUser } from '../config/api';

const ProcessTaxonomy = ({ onNavigateToWorkflow, currentUser }) => {
  const [taxonomy, setTaxonomy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showAssignmentForm, setShowAssignmentForm] = useState(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templateLevel, setTemplateLevel] = useState(0);
  const [templateParentId, setTemplateParentId] = useState(null);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [dashboardData, setDashboardData] = useState(null);
  const [showFilter, setShowFilter] = useState(false);
  const [completionFilter, setCompletionFilter] = useState('all'); // 'all', 'completed', 'not_completed'
  const [selectedProcess, setSelectedProcess] = useState(null); // For showing flows
  const [l3ProcessPopup, setL3ProcessPopup] = useState(null); // For L3 process popup
  const [l3Processes, setL3Processes] = useState([]); // All L3 processes for current L2
  const [currentL3Index, setCurrentL3Index] = useState(0); // Current L3 process index
  const [showMoreActions, setShowMoreActions] = useState(null); // For three dots menu
  const [menuPosition, setMenuPosition] = useState('down'); // Track menu position
  const [expandedDescription, setExpandedDescription] = useState(false); // For expandable description
  const [newItem, setNewItem] = useState({
    name: '',
    description: '',
    code: '',
    level: 0,
    parent_id: null
  });
  const [assignment, setAssignment] = useState({
    user_email: '',
    role: 'delegatee'
  });


  useEffect(() => {
    loadTaxonomy();
    loadDashboardData();
  }, [currentUser]);

  // Function to determine menu position
  const handleMoreActionsClick = (itemId, event) => {
    if (showMoreActions === itemId) {
      setShowMoreActions(null);
      return;
    }

    // Check if there's enough space below the button
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const menuHeight = 100; // Approximate menu height

    // If not enough space below, open upward
    if (spaceBelow < menuHeight) {
      setMenuPosition('up');
    } else {
      setMenuPosition('down');
    }

    setShowMoreActions(itemId);
  };

  // Close more actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showMoreActions && !event.target.closest('.more-actions')) {
        setShowMoreActions(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMoreActions]);

  // Populate form when editing
  useEffect(() => {
    if (editingItem) {
      setNewItem({
        name: editingItem.name,
        description: editingItem.description || '',
        code: editingItem.code || '',
        level: editingItem.level,
        parent_id: editingItem.parent_id
      });
      setShowAddForm(true);
    }
  }, [editingItem]);

  const loadTaxonomy = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy`,
        { method: 'GET' }
      );
      if (!response.ok) throw new Error('Failed to load taxonomy');
      const data = await response.json();
      setTaxonomy(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardData = async () => {
    try {
      if (!currentUser?.id) {
        console.log('User not loaded yet, skipping dashboard data load');
        return;
      }
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/dashboard/${currentUser.id}`,
        { method: 'GET' }
      );
      if (!response.ok) throw new Error('Failed to load dashboard data');
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    try {
      const isEditing = editingItem !== null;
      const url = isEditing 
        ? `${API_BASE_URL}/api/process-taxonomy/${editingItem.id}`
        : `${API_BASE_URL}/api/process-taxonomy`;
      
      const response = await authenticatedFetch(
        url,
        {
          method: isEditing ? 'PUT' : 'POST',
          body: newItem
        }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Failed to ${isEditing ? 'update' : 'create'} item`);
      }
      
      await loadTaxonomy();
      setNewItem({ name: '', description: '', code: '', level: 0, parent_id: null });
      setShowAddForm(false);
      setEditingItem(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Are you sure you want to delete "${item.name}" and all its children? This action cannot be undone.`)) {
      return;
    }
    
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy/${item.id}`,
        { method: 'DELETE' }
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to delete item');
      }
      
      await loadTaxonomy();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAssignUser = async (e) => {
    e.preventDefault();
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-assignments`,
        {
          method: 'POST',
          body: {
            process_id: showAssignmentForm,
            ...assignment
          }
        }
      );
      if (!response.ok) throw new Error('Failed to assign user');
      setAssignment({ user_email: '', role: 'delegatee' });
      setShowAssignmentForm(null);
      // Show success message
      alert('User assigned successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTemplateSelected = (createdItems) => {
    // Reload taxonomy to show the new items
    loadTaxonomy();
    alert(`Template applied successfully! Created ${createdItems.length} process items.`);
  };

  const handleUseTemplate = (level, parentId = null) => {
    setTemplateLevel(level);
    setTemplateParentId(parentId);
    setShowTemplateSelector(true);
  };

  const toggleExpanded = (itemId) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const getFilteredTaxonomy = () => {
    if (completionFilter === 'all') return taxonomy;
    
    // Filter based on whether L3 processes have flows
    const filterRecursively = (items) => {
      return items.map(item => {
        const filteredItem = { ...item };
        
        // Filter children recursively first
        if (item.children && item.children.length > 0) {
          filteredItem.children = filterRecursively(item.children);
        }
        
        return filteredItem;
      }).filter(item => {
        // For L3 processes (level 3), check if they have flows
        if (item.level === 3) {
          const hasFlows = dashboardData?.process_flows?.some(flow => flow.process_id === item.id) || false;
          if (completionFilter === 'completed') {
            return hasFlows;
          } else if (completionFilter === 'not_completed') {
            return !hasFlows;
          }
        }
        
        // For parent levels (L0, L1, L2), ONLY keep them if they have children after filtering
        // This hides parent levels when all their L3 descendants are filtered out
        if (item.level < 3) {
          return item.children && item.children.length > 0;
        }
        
        return false;
      });
    };
    
    return filterRecursively(taxonomy);
  };

  const handleProcessClick = (item) => {
    if (item.level === 3) {
      // Find all L3 processes under the same L2 parent
      const l2Parent = findL2Parent(item);
      const allL3Processes = l2Parent ? getAllL3Processes(l2Parent) : [item];
      setL3Processes(allL3Processes);
      setCurrentL3Index(allL3Processes.findIndex(p => p.id === item.id));
      setL3ProcessPopup(item);
      setExpandedDescription(false);
    }
  };

  const findL2Parent = (l3Process) => {
    const findParent = (items, targetId) => {
      for (const item of items) {
        if (item.id === targetId) return item;
        if (item.children) {
          const found = findParent(item.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };
    
    // Find the L2 parent by looking for the item with level 2 that contains this L3
    const findL2 = (items) => {
      for (const item of items) {
        if (item.level === 2 && item.children) {
          const hasL3 = item.children.some(child => child.id === l3Process.id || 
            (child.children && findL2(child.children)));
          if (hasL3) return item;
        }
        if (item.children) {
          const found = findL2(item.children);
          if (found) return found;
        }
      }
      return null;
    };
    
    return findL2(taxonomy);
  };

  const getAllL3Processes = (l2Process) => {
    const l3Processes = [];
    const collectL3 = (items) => {
      for (const item of items) {
        if (item.level === 3) {
          l3Processes.push(item);
        }
        if (item.children) {
          collectL3(item.children);
        }
      }
    };
    
    if (l2Process.children) {
      collectL3(l2Process.children);
    }
    return l3Processes;
  };

  const navigateL3Process = (direction) => {
    if (direction === 'prev' && currentL3Index > 0) {
      setCurrentL3Index(currentL3Index - 1);
    } else if (direction === 'next' && currentL3Index < l3Processes.length - 1) {
      setCurrentL3Index(currentL3Index + 1);
    }
  };

  const closeL3ProcessPopup = () => {
    setL3ProcessPopup(null);
    setL3Processes([]);
    setCurrentL3Index(0);
    setExpandedDescription(false);
  };

  const getAssignedUserInitials = (item) => {
    // Mock data - in real app, this would come from the item data
    if (item.assigned_user) {
      const name = item.assigned_user.name || item.assigned_user.email;
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return null;
  };

  const renderTaxonomyItem = (item, level = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isL3Process = item.level === 3;
    const childCount = item.children ? item.children.length : 0;
    const assignedUserInitials = getAssignedUserInitials(item);
    
    return (
      <div key={item.id} className="taxonomy-item">
        <div className="taxonomy-item-header">
          <div className="taxonomy-item-info">
            <div className="taxonomy-indent" style={{ width: `${level * 24}px` }}></div>
            {hasChildren ? (
              <button 
                className="expand-toggle"
                onClick={() => toggleExpanded(item.id)}
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            ) : (
              <span className="expand-spacer"></span>
            )}
            <span className="level-badge">L{item.level}</span>
            <div className="taxonomy-item-content">
              <div className="taxonomy-item-title-row">
            <h4 
              className={isL3Process ? 'clickable-process' : ''}
              onClick={isL3Process ? () => handleProcessClick(item) : undefined}
              title={isL3Process ? 'Click to view process flows' : ''}
            >
              {item.name}
            </h4>
            {item.code && <span className="code-badge">{item.code}</span>}
                {hasChildren && <span className="child-count">{childCount} {childCount === 1 ? 'child' : 'children'}</span>}
              </div>
              {item.description && (
                <p className="taxonomy-item-description">{item.description}</p>
              )}
            </div>
          </div>
          <div className="taxonomy-item-actions">
            {item.level < 3 ? (
            <button 
              className="btn btn-sm btn-success"
              onClick={() => {
                setNewItem({ ...newItem, level: item.level + 1, parent_id: item.id });
                setShowAddForm(true);
              }}
              title="Add a child process"
            >
              Add Child
            </button>
            ) : (
            <button 
              className="btn btn-sm btn-primary"
              onClick={() => handleProcessClick(item)}
              title="Edit process flow"
            >
              Edit process flow
            </button>
            )}
            <button 
              className="btn btn-sm btn-outline"
              onClick={() => setShowAssignmentForm(item.id)}
              title="Assign users to this process"
            >
              Assign
            </button>
            {assignedUserInitials && (
              <div className="assigned-user">
                <div className="user-initials">{assignedUserInitials}</div>
              </div>
            )}
            <div className="more-actions">
              <button 
                className="more-actions-btn"
                onClick={(e) => handleMoreActionsClick(item.id, e)}
                title="More actions"
              >
                ⋯
              </button>
              {showMoreActions === item.id && (
                <div className={`more-actions-menu ${menuPosition === 'up' ? 'upward' : ''}`}>
                  <button onClick={() => {
                    setEditingItem(item);
                    setShowMoreActions(null);
                  }}>
                    Edit
            </button>
            <button 
                    className="danger"
                    onClick={() => {
                      handleDeleteItem(item);
                      setShowMoreActions(null);
                    }}
            >
              Delete
            </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="taxonomy-children">
            {item.children.map(child => renderTaxonomyItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="process-taxonomy">
        <div className="loading">Loading process taxonomy...</div>
      </div>
    );
  }

  const filteredTaxonomy = getFilteredTaxonomy();

  const renderL3ProcessPopup = () => {
    if (!l3ProcessPopup || l3Processes.length === 0) return null;
    
    const currentProcess = l3Processes[currentL3Index];
    
    return (
      <div className="l3-process-popup" onClick={(e) => e.target === e.currentTarget && closeL3ProcessPopup()}>
        <div className="l3-process-popup-content">
          <div className="l3-process-header">
            <div className="l3-process-title-section">
              <h2>{currentProcess.name}</h2>
              <div className="l3-process-id">ID: {currentProcess.id}</div>
            </div>
            <div className="l3-process-nav">
              <button 
                onClick={() => navigateL3Process('prev')}
                disabled={currentL3Index === 0}
                title="Previous process"
              >
                ←
              </button>
              <span>{currentL3Index + 1} of {l3Processes.length}</span>
              <button 
                onClick={() => navigateL3Process('next')}
                disabled={currentL3Index === l3Processes.length - 1}
                title="Next process"
              >
                →
              </button>
              <button 
                className="l3-process-close"
                onClick={closeL3ProcessPopup}
                title="Close"
              >
                ×
              </button>
            </div>
          </div>
          
          <div className="l3-process-body">
            <div className="l3-process-meta">
              <div className="l3-process-meta-item">
                <div className="l3-process-meta-label">Last Updated</div>
                <div className="l3-process-meta-value">
                  {currentProcess.updated_at ? new Date(currentProcess.updated_at).toLocaleDateString() : 'Never'}
                </div>
              </div>
              <div className="l3-process-meta-item">
                <div className="l3-process-meta-label">Assigned To</div>
                <div className="l3-process-meta-value">
                  {currentProcess.assigned_user ? 
                    `${currentProcess.assigned_user.name || currentProcess.assigned_user.email}` : 
                    'Unassigned'
                  }
                </div>
              </div>
            </div>
            
            <div className="l3-process-description">
              <div className="l3-process-description-header">
                <h3>Description</h3>
                <button 
                  className="l3-process-description-toggle"
                  onClick={() => setExpandedDescription(!expandedDescription)}
                >
                  {expandedDescription ? 'Show Less' : 'Show More'}
                </button>
              </div>
              {expandedDescription && currentProcess.description && (
                <div className="l3-process-description-content">
                  {currentProcess.description}
                </div>
              )}
            </div>
            
            <div className="l3-process-flow-preview">
              <h3>Process Flow Preview</h3>
              <p>View and edit the detailed process flow for this L3 process.</p>
              <button 
                className="l3-process-flow-preview-btn"
                onClick={() => {
                  closeL3ProcessPopup();
                  onNavigateToWorkflow(currentProcess.id, currentProcess.name);
                }}
              >
                See Full Process Flow
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="process-taxonomy">
      {/* Integrated Header */}
      <div className="integrated-header">
        <div className="header-main">
          <div className="header-left">
            <h2>Process taxonomy</h2>
            <p>Define your organization's process taxonomy</p>
          </div>
        </div>
      </div>

      {/* Process Section Header */}
      <div className="process-section-header">
        <div className="process-section-left">
          {/* Stats moved here with smaller font */}
          {dashboardData && (
            <div className="header-stats-small">
              <div className="stat-item-small">
                <span className="stat-number-small">{dashboardData.completion_stats.completed + dashboardData.completion_stats.in_progress + dashboardData.completion_stats.not_started}</span>
                <span className="stat-label-small"># of L3 Processes</span>
              </div>
              <div className="stat-item-small">
                <span className="stat-number-small">{dashboardData.completion_stats.completed + dashboardData.completion_stats.in_progress + dashboardData.completion_stats.not_started > 0 ? Math.round((dashboardData.completion_stats.completed / (dashboardData.completion_stats.completed + dashboardData.completion_stats.in_progress + dashboardData.completion_stats.not_started)) * 100) : 0}%</span>
                <span className="stat-label-small">Completion Rate</span>
              </div>
            </div>
          )}
        </div>
        <div className="process-section-right">
          <div className="process-filters">
            <label className="filter-label">Show:</label>
                <select 
              className="filter-select"
                  value={completionFilter} 
                  onChange={(e) => setCompletionFilter(e.target.value)}
                >
                  <option value="all">All Processes</option>
                  <option value="completed">Completed</option>
                  <option value="not_completed">Not Completed</option>
                </select>
            <span className="results-count">
              {filteredTaxonomy.length} {filteredTaxonomy.length === 1 ? 'process' : 'processes'}
            </span>
          </div>
          <div className="process-actions">
          <button 
            className="btn btn-primary"
            onClick={() => {
              setNewItem({ name: '', description: '', code: '', level: 0, parent_id: null });
              setShowAddForm(true);
            }}
          >
            Add Root Process
          </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="taxonomy-tree">
        {filteredTaxonomy.length === 0 ? (
          <div className="empty-state">
            <p>{completionFilter === 'all' ? 'No processes defined yet. Start by adding a root process.' : 'No processes match your filter criteria.'}</p>
          </div>
        ) : (
          filteredTaxonomy.map(item => renderTaxonomyItem(item))
        )}
      </div>

      {/* Process Flow Viewer for L3 processes */}
      {selectedProcess && (
        <ProcessFlowViewer
          processId={selectedProcess.id}
          processName={selectedProcess.name}
          onClose={() => setSelectedProcess(null)}
          onNavigateToWorkflow={onNavigateToWorkflow}
        />
      )}

      {/* Add/Edit Form Modal */}
      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{editingItem ? 'Edit Process' : 'Add New Process'}</h3>
              <button 
                className="btn-close"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingItem(null);
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAddItem} className="modal-body">
              <div className="form-group">
                <label>Process Name *</label>
                <input
                  type="text"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  rows="3"
                />
              </div>
              <div className="form-group">
                <label>Code</label>
                <input
                  type="text"
                  value={newItem.code}
                  onChange={(e) => setNewItem({ ...newItem, code: e.target.value })}
                  placeholder="e.g., DEPT001, PROC001"
                />
              </div>
              <div className="form-group">
                <label>Level</label>
                <select
                  value={newItem.level}
                  onChange={(e) => setNewItem({ ...newItem, level: parseInt(e.target.value) })}
                >
                  <option value={0}>L0 - Organization</option>
                  <option value={1}>L1 - Department</option>
                  <option value={2}>L2 - Function</option>
                  <option value={3}>L3 - Process</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingItem ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignment Form Modal */}
      {showAssignmentForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Assign User to Process</h3>
              <button 
                className="btn-close"
                onClick={() => setShowAssignmentForm(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAssignUser} className="modal-body">
              <div className="form-group">
                <label>User Email *</label>
                <input
                  type="email"
                  value={assignment.user_email}
                  onChange={(e) => setAssignment({ ...assignment, user_email: e.target.value })}
                  required
                  placeholder="user@example.com"
                />
                <small className="form-help">
                  The user will receive an email invitation to sign up and access their assigned processes.
                </small>
              </div>
              <div className="form-group">
                <label>Role</label>
                <select
                  value={assignment.role}
                  onChange={(e) => setAssignment({ ...assignment, role: e.target.value })}
                >
                  <option value="owner">Owner - Full control</option>
                  <option value="delegator">Delegator - Can assign and review</option>
                  <option value="delegatee">Delegatee - Can create and submit processes</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAssignmentForm(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Assign User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Template Selector Modal */}
      {showTemplateSelector && (
        <TemplateSelector
          level={templateLevel}
          parentId={templateParentId}
          onTemplateSelected={handleTemplateSelected}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}

      {/* L3 Process Popup */}
      {renderL3ProcessPopup()}
    </div>
  );
};

export default ProcessTaxonomy;

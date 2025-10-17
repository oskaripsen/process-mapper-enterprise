import { API_BASE_URL, authenticatedFetch } from '../config/api';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const TemplateSelector = ({ onTemplateSelected, onClose, level, parentId = null }) => {
  const { getToken } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');


  useEffect(() => {
    loadTemplates();
    loadCategories();
  }, [level, selectedCategory, searchQuery]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      let url = `${API_BASE_URL}/api/templates/level/${level}`;
      
      if (selectedCategory) {
        url = `${API_BASE_URL}/api/templates/category/${selectedCategory}`;
      }
      
      if (searchQuery) {
        const response = await fetch(`${API_BASE_URL}/api/templates/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: searchQuery,
            level: level,
            category: selectedCategory || null
          })
        });
        const data = await response.json();
        setTemplates(data);
      } else {
        const response = await fetch(url);
        const data = await response.json();
        setTemplates(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/templates/categories`);
      const data = await response.json();
      setCategories(data);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  };

  const handleTemplateSelect = async (template) => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/templates/apply`,
        {
          method: 'POST',
          body: {
            template_id: template.id,
            parent_id: parentId,
            customizations: null
          }
        },
        getToken
      );
      
      if (!response.ok) throw new Error('Failed to apply template');
      
      const createdItems = await response.json();
      onTemplateSelected(createdItems);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const getLevelName = (level) => {
    switch (level) {
      case 0: return 'Organization';
      case 1: return 'Department';
      case 2: return 'Function';
      case 3: return 'Process';
      default: return 'Unknown';
    }
  };

  const getCategoryIcon = (category) => {
    const icons = {
      technology: '💻',
      manufacturing: '🏭',
      healthcare: '🏥',
      education: '🎓',
      finance: '💰',
      retail: '🛍️',
      business: '💼',
      government: '🏛️'
    };
    return icons[category] || '📋';
  };

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <div className="modal-header">
            <h3>Select {getLevelName(level)} Template</h3>
            <button className="btn-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="loading">Loading templates...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal template-selector">
        <div className="modal-header">
          <h3>Select {getLevelName(level)} Template</h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          {/* Search and Filter */}
          <div className="template-filters">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
            
            <div className="category-filter">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="category-select"
              >
                <option value="">All Categories</option>
                {categories.map(category => (
                  <option key={category} value={category}>
                    {getCategoryIcon(category)} {category.charAt(0).toUpperCase() + category.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Templates Grid */}
          <div className="templates-grid">
            {templates.length === 0 ? (
              <div className="empty-state">
                <p>No templates found for {getLevelName(level)} level.</p>
                <p>Try adjusting your search or category filter.</p>
              </div>
            ) : (
              templates.map(template => (
                <div key={template.id} className="template-card">
                  <div className="template-header">
                    <div className="template-icon">
                      {getCategoryIcon(template.category)}
                    </div>
                    <div className="template-info">
                      <h4>{template.name}</h4>
                      <span className="template-category">
                        {template.category.charAt(0).toUpperCase() + template.category.slice(1)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="template-description">
                    <p>{template.description}</p>
                  </div>
                  
                  <div className="template-preview">
                    {template.level === 0 && template.template_data.departments && (
                      <div className="preview-section">
                        <strong>Departments:</strong>
                        <ul>
                          {template.template_data.departments.slice(0, 3).map((dept, idx) => (
                            <li key={idx}>{dept.name}</li>
                          ))}
                          {template.template_data.departments.length > 3 && (
                            <li>+{template.template_data.departments.length - 3} more...</li>
                          )}
                        </ul>
                      </div>
                    )}
                    
                    {template.level === 1 && template.template_data.functions && (
                      <div className="preview-section">
                        <strong>Functions:</strong>
                        <ul>
                          {template.template_data.functions.slice(0, 3).map((func, idx) => (
                            <li key={idx}>{func.name}</li>
                          ))}
                          {template.template_data.functions.length > 3 && (
                            <li>+{template.template_data.functions.length - 3} more...</li>
                          )}
                        </ul>
                      </div>
                    )}
                    
                    {template.level === 2 && template.template_data.processes && (
                      <div className="preview-section">
                        <strong>Processes:</strong>
                        <ul>
                          {template.template_data.processes.slice(0, 3).map((process, idx) => (
                            <li key={idx}>{process.name}</li>
                          ))}
                          {template.template_data.processes.length > 3 && (
                            <li>+{template.template_data.processes.length - 3} more...</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                  
                  <div className="template-actions">
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleTemplateSelect(template)}
                    >
                      Use This Template
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateSelector;



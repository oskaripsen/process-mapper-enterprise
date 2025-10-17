-- AI Process Mapper Enterprise Edition - SQLite Database Schema
-- SQLite Database Schema (file-based, no installation required)

-- Users table (simplified auth)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    preferences TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Process Taxonomy table (hierarchy of processes)
CREATE TABLE IF NOT EXISTS process_taxonomy (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    parent_id TEXT,
    level TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    code TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (parent_id) REFERENCES process_taxonomy(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Process Flows table (stores workflow diagrams)
CREATE TABLE IF NOT EXISTS process_flows (
    id TEXT PRIMARY KEY,
    process_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    flow_data TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    is_published INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (process_id) REFERENCES process_taxonomy(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Process Assignments table (assign users to processes)
CREATE TABLE IF NOT EXISTS process_assignments (
    id TEXT PRIMARY KEY,
    process_id TEXT,
    user_id TEXT,
    role TEXT,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by TEXT,
    FOREIGN KEY (process_id) REFERENCES process_taxonomy(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id)
);

-- Process Reviews table (review and approval workflow)
CREATE TABLE IF NOT EXISTS process_reviews (
    id TEXT PRIMARY KEY,
    flow_id TEXT,
    reviewer_id TEXT,
    status TEXT NOT NULL,
    comments TEXT,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (flow_id) REFERENCES process_flows(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_process_taxonomy_parent ON process_taxonomy(parent_id);
CREATE INDEX IF NOT EXISTS idx_process_taxonomy_org ON process_taxonomy(organization_id);
CREATE INDEX IF NOT EXISTS idx_process_taxonomy_level ON process_taxonomy(level);
CREATE INDEX IF NOT EXISTS idx_process_flows_process ON process_flows(process_id);
CREATE INDEX IF NOT EXISTS idx_process_flows_created_by ON process_flows(created_by);
CREATE INDEX IF NOT EXISTS idx_process_assignments_process ON process_assignments(process_id);
CREATE INDEX IF NOT EXISTS idx_process_assignments_user ON process_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_process_reviews_flow ON process_reviews(flow_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Triggers to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_users_updated_at 
AFTER UPDATE ON users
BEGIN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_process_taxonomy_updated_at 
AFTER UPDATE ON process_taxonomy
BEGIN
    UPDATE process_taxonomy SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_process_flows_updated_at 
AFTER UPDATE ON process_flows
BEGIN
    UPDATE process_flows SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

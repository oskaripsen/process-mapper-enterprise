#!/usr/bin/env python3
"""
Initialize SQLite database for AI Process Mapper Enterprise Edition
Creates the database file and runs the schema
"""
import sqlite3
import os
import sys

def init_database(db_path="process_mapper.db"):
    """Initialize the SQLite database"""
    
    # Make path absolute relative to this script
    if not os.path.isabs(db_path):
        script_dir = os.path.dirname(__file__)
        db_path = os.path.join(script_dir, db_path)
    
    print(f"Initializing database at: {db_path}")
    
    # Check if database already exists
    if os.path.exists(db_path):
        response = input(f"Database file '{db_path}' already exists. Overwrite? (y/N): ")
        if response.lower() != 'y':
            print("Aborted.")
            return False
        os.remove(db_path)
        print("Existing database removed.")
    
    # Read schema file
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    if not os.path.exists(schema_path):
        print(f"Error: schema.sql not found at {schema_path}")
        return False
    
    with open(schema_path, 'r') as f:
        schema_sql = f.read()
    
    # Create database and execute schema
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Execute schema
        cursor.executescript(schema_sql)
        conn.commit()
        
        # Verify tables were created
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print(f"\n✓ Database initialized successfully!")
        print(f"✓ Created {len(tables)} tables:")
        for table in tables:
            print(f"  - {table[0]}")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"\n✗ Error initializing database: {e}")
        return False


if __name__ == "__main__":
    # Get database path from command line or use default
    db_path = sys.argv[1] if len(sys.argv) > 1 else "process_mapper.db"
    
    success = init_database(db_path)
    sys.exit(0 if success else 1)


"""
Snowflake Service for storing analysis and feedback data.

Environment variables required:
- SNOWFLAKE_ACCOUNT: Your Snowflake account identifier
- SNOWFLAKE_USER: Snowflake username
- SNOWFLAKE_PAT: Snowflake Programmatic Access Token (or SNOWFLAKE_PASSWORD)
- SNOWFLAKE_WAREHOUSE: Warehouse to use
- SNOWFLAKE_DATABASE: Database name
- SNOWFLAKE_SCHEMA: Schema name
- SNOWFLAKE_ROLE: Role to use (optional)
"""

import os
import json
from datetime import datetime
from typing import Optional, Dict, Any, List
import snowflake.connector
from contextlib import contextmanager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def get_connection_params() -> Dict[str, Any]:
    """Get Snowflake connection parameters from environment variables."""
    params = {
        "account": os.environ.get("SNOWFLAKE_ACCOUNT", ""),
        "user": os.environ.get("SNOWFLAKE_USER", ""),
        "warehouse": os.environ.get("SNOWFLAKE_WAREHOUSE", ""),
        "database": os.environ.get("SNOWFLAKE_DATABASE", "SAL_DEV_SANDBOX"),
        "schema": os.environ.get("SNOWFLAKE_SCHEMA", "CHROME_EXTENSION_FEEDBACK"),
    }

    # Support PAT token auth (preferred) or password auth
    pat = os.environ.get("SNOWFLAKE_PAT")
    if pat:
        params["token"] = pat
        params["authenticator"] = "programmatic_access_token"
    else:
        params["password"] = os.environ.get("SNOWFLAKE_PASSWORD", "")

    role = os.environ.get("SNOWFLAKE_ROLE")
    if role:
        params["role"] = role

    return params


@contextmanager
def get_connection():
    """Context manager for Snowflake connections."""
    conn = None
    try:
        conn = snowflake.connector.connect(**get_connection_params())
        yield conn
    finally:
        if conn:
            conn.close()


def generate_analysis_id(deal_id: str, analysis_type: str) -> str:
    """Generate a unique analysis ID."""
    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    return f"deal_{deal_id}_{analysis_type}_{timestamp}"


def get_active_analysis_types() -> List[Dict[str, Any]]:
    """
    Fetch active analysis types from Snowflake.

    Returns a list of analysis type configs with keys:
    - type_id, name, description, system_prompt, version, metadata
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            sql = """
                SELECT
                    type_id,
                    name,
                    description,
                    system_prompt,
                    version,
                    metadata
                FROM ANALYSIS_TYPES
                WHERE is_active = TRUE
                ORDER BY type_id
            """

            cursor.execute(sql)
            rows = cursor.fetchall()

            types = []
            for row in rows:
                types.append({
                    'type_id': row[0],
                    'name': row[1],
                    'description': row[2],
                    'system_prompt': row[3],
                    'version': row[4],
                    'metadata': json.loads(row[5]) if row[5] else {}
                })

            return types

    except Exception as e:
        print(f"Error fetching analysis types: {e}")
        return []


def get_analysis_type(type_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch a specific analysis type by ID.

    Returns the analysis type config or None if not found.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            sql = """
                SELECT
                    type_id,
                    name,
                    description,
                    system_prompt,
                    version,
                    metadata
                FROM ANALYSIS_TYPES
                WHERE type_id = %s AND is_active = TRUE
            """

            cursor.execute(sql, (type_id,))
            row = cursor.fetchone()

            if row:
                return {
                    'type_id': row[0],
                    'name': row[1],
                    'description': row[2],
                    'system_prompt': row[3],
                    'version': row[4],
                    'metadata': json.loads(row[5]) if row[5] else {}
                }

            return None

    except Exception as e:
        print(f"Error fetching analysis type {type_id}: {e}")
        return None


def parse_sections(markdown_text: str) -> List[Dict[str, str]]:
    """
    Parse markdown response into sections based on h2 headers.

    Returns a list of dicts with section_id, section_title, and content.
    """
    sections = []
    lines = markdown_text.split('\n')

    current_section = None
    current_content = []
    section_counter = 0

    for line in lines:
        # Check for h2 header (## Header)
        if line.startswith('## '):
            # Save previous section if exists
            if current_section:
                current_section['content'] = '\n'.join(current_content).strip()
                sections.append(current_section)

            section_counter += 1
            title = line[3:].strip()

            # Generate section_id from title (slugify)
            section_id = f"section_{section_counter}"

            current_section = {
                'section_id': section_id,
                'section_title': title,
                'content': ''
            }
            current_content = []
        elif current_section:
            current_content.append(line)

    # Don't forget the last section
    if current_section:
        current_section['content'] = '\n'.join(current_content).strip()
        sections.append(current_section)

    return sections


def save_analysis(
    analysis_id: str,
    deal_id: str,
    deal_name: str,
    analysis_type: str,
    user_input: str,
    system_prompt: str,
    full_response: str,
    prompt_version: int = 1,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Save an analysis record to Snowflake.

    Returns True if successful, False otherwise.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            sql = """
                INSERT INTO ANALYSES (
                    analysis_id,
                    deal_id,
                    deal_name,
                    analysis_type,
                    user_input,
                    system_prompt,
                    full_response,
                    prompt_version,
                    metadata,
                    created_at
                )
                SELECT %s, %s, %s, %s, %s, %s, %s, %s, PARSE_JSON(%s), CURRENT_TIMESTAMP()
            """

            cursor.execute(sql, (
                analysis_id,
                deal_id,
                deal_name,
                analysis_type,
                user_input,
                system_prompt,
                full_response,
                prompt_version,
                json.dumps(metadata or {})
            ))

            conn.commit()
            return True

    except Exception as e:
        print(f"Error saving analysis: {e}")
        return False


def save_feedback(
    analysis_id: str,
    section_id: str,
    section_title: str,
    feedback: str,
    feedback_reason: Optional[str] = None,
    user_correction: Optional[str] = None,
    prompt_version: int = 1,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Save a feedback record to Snowflake.
    Uses MERGE to prevent duplicate feedback for the same analysis/section.

    Args:
        analysis_id: Links to the ANALYSES table
        section_id: e.g., 'section_1', 'section_2'
        section_title: The h2 header text
        feedback: 'up' or 'down'
        feedback_reason: Optional explanation
        user_correction: Optional correction text
        prompt_version: Version of the prompt that generated the analysis
        metadata: Optional additional context

    Returns True if successful, False otherwise.
    """
    if feedback not in ('up', 'down'):
        raise ValueError("Feedback must be 'up' or 'down'")

    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            # Check if feedback already exists for this analysis/section
            check_sql = """
                SELECT COUNT(*) FROM FEEDBACK
                WHERE analysis_id = %s AND section_id = %s
            """
            cursor.execute(check_sql, (analysis_id, section_id))
            count = cursor.fetchone()[0]

            if count > 0:
                # Feedback already exists, don't insert duplicate
                print(f"Feedback already exists for {analysis_id}/{section_id}")
                return True

            sql = """
                INSERT INTO FEEDBACK (
                    analysis_id,
                    section_id,
                    section_title,
                    feedback,
                    feedback_reason,
                    user_correction,
                    prompt_version,
                    metadata,
                    created_at
                )
                SELECT %s, %s, %s, %s, %s, %s, %s, PARSE_JSON(%s), CURRENT_TIMESTAMP()
            """

            cursor.execute(sql, (
                analysis_id,
                section_id,
                section_title,
                feedback,
                feedback_reason,
                user_correction,
                prompt_version,
                json.dumps(metadata or {})
            ))

            conn.commit()
            return True

    except Exception as e:
        print(f"Error saving feedback: {e}")
        return False


def create_tables_if_not_exist() -> bool:
    """
    Create the ANALYSIS_TYPES, ANALYSES and FEEDBACK tables if they don't exist.

    Run this once to set up the schema.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            # Create ANALYSIS_TYPES table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ANALYSIS_TYPES (
                    type_id VARCHAR(50) PRIMARY KEY,
                    name VARCHAR(255),
                    description TEXT,
                    system_prompt TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    version INT DEFAULT 1,
                    metadata VARIANT,
                    created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                    updated_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
            """)

            # Create ANALYSES table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ANALYSES (
                    analysis_id VARCHAR(255) PRIMARY KEY,
                    deal_id VARCHAR(255),
                    deal_name VARCHAR(500),
                    analysis_type VARCHAR(50),
                    user_input TEXT,
                    system_prompt TEXT,
                    full_response TEXT,
                    prompt_version INT DEFAULT 1,
                    metadata VARIANT,
                    created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
            """)

            # Create FEEDBACK table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS FEEDBACK (
                    id NUMBER AUTOINCREMENT,
                    analysis_id VARCHAR(255),
                    section_id VARCHAR(255),
                    section_title VARCHAR(500),
                    feedback VARCHAR(10),
                    feedback_reason TEXT,
                    user_correction TEXT,
                    prompt_version INT DEFAULT 1,
                    metadata VARIANT,
                    created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
            """)

            conn.commit()
            return True

    except Exception as e:
        print(f"Error creating tables: {e}")
        return False


def seed_analysis_types(types: List[Dict[str, Any]]) -> bool:
    """
    Seed the ANALYSIS_TYPES table with initial data.

    Args:
        types: List of dicts with keys: type_id, name, description, system_prompt, metadata

    Returns True if successful, False otherwise.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            for t in types:
                sql = """
                    MERGE INTO ANALYSIS_TYPES AS target
                    USING (SELECT %s AS type_id) AS source
                    ON target.type_id = source.type_id
                    WHEN MATCHED THEN UPDATE SET
                        name = %s,
                        description = %s,
                        system_prompt = %s,
                        metadata = PARSE_JSON(%s),
                        version = version + 1,
                        updated_at = CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN INSERT (
                        type_id, name, description, system_prompt, metadata
                    ) VALUES (%s, %s, %s, %s, PARSE_JSON(%s))
                """

                cursor.execute(sql, (
                    t['type_id'],
                    t['name'],
                    t['description'],
                    t['system_prompt'],
                    json.dumps(t.get('metadata', {})),
                    t['type_id'],
                    t['name'],
                    t['description'],
                    t['system_prompt'],
                    json.dumps(t.get('metadata', {}))
                ))

            conn.commit()
            return True

    except Exception as e:
        print(f"Error seeding analysis types: {e}")
        return False

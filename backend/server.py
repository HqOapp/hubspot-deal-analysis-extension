"""
Minimal backend server for Chrome extension to interact with Snowflake.

Run with: python backend/server.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from snowflake_service import (
    get_active_analysis_types,
    get_analysis_type,
    save_analysis,
    save_feedback,
    generate_analysis_id,
    parse_sections
)

app = Flask(__name__)
CORS(app)  # Allow extension to make requests


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'})


@app.route('/api/debug/snowflake', methods=['GET'])
def debug_snowflake():
    """Debug endpoint to test Snowflake connection."""
    import os
    from snowflake_service import get_connection

    # Check which env vars are set (not their values)
    env_status = {
        'SNOWFLAKE_ACCOUNT': bool(os.environ.get('SNOWFLAKE_ACCOUNT')),
        'SNOWFLAKE_USER': bool(os.environ.get('SNOWFLAKE_USER')),
        'SNOWFLAKE_PAT': bool(os.environ.get('SNOWFLAKE_PAT')),
        'SNOWFLAKE_WAREHOUSE': bool(os.environ.get('SNOWFLAKE_WAREHOUSE')),
        'SNOWFLAKE_DATABASE': os.environ.get('SNOWFLAKE_DATABASE', 'SAL_DEV_SANDBOX (default)'),
        'SNOWFLAKE_SCHEMA': os.environ.get('SNOWFLAKE_SCHEMA', 'CHROME_EXTENSION_FEEDBACK (default)'),
    }

    # Try to connect and run a simple query
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT CURRENT_DATABASE(), CURRENT_SCHEMA(), COUNT(*) FROM ANALYSIS_TYPES")
            row = cursor.fetchone()
            return jsonify({
                'env_vars': env_status,
                'connection': 'success',
                'current_database': row[0],
                'current_schema': row[1],
                'analysis_types_count': row[2]
            })
    except Exception as e:
        return jsonify({
            'env_vars': env_status,
            'connection': 'failed',
            'error': str(e)
        }), 500


@app.route('/api/analysis-types', methods=['GET'])
def list_analysis_types():
    """Get all active analysis types from Snowflake."""
    types = get_active_analysis_types()
    return jsonify(types)


@app.route('/api/analysis-types/<type_id>', methods=['GET'])
def get_single_analysis_type(type_id):
    """Get a specific analysis type by ID."""
    analysis_type = get_analysis_type(type_id)
    if analysis_type:
        return jsonify(analysis_type)
    return jsonify({'error': 'Analysis type not found'}), 404


@app.route('/api/analyses', methods=['POST'])
def create_analysis():
    """Save a new analysis to Snowflake."""
    data = request.json

    required_fields = ['deal_id', 'deal_name', 'analysis_type', 'user_input', 'system_prompt', 'full_response']
    for field in required_fields:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400

    analysis_id = generate_analysis_id(data['deal_id'], data['analysis_type'])

    success = save_analysis(
        analysis_id=analysis_id,
        deal_id=data['deal_id'],
        deal_name=data['deal_name'],
        analysis_type=data['analysis_type'],
        user_input=data['user_input'],
        system_prompt=data['system_prompt'],
        full_response=data['full_response'],
        prompt_version=data.get('prompt_version', 1),
        metadata=data.get('metadata')
    )

    if success:
        return jsonify({
            'analysis_id': analysis_id,
            'sections': parse_sections(data['full_response'])
        })
    return jsonify({'error': 'Failed to save analysis'}), 500


@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    """Save feedback on an analysis section."""
    data = request.json

    required_fields = ['analysis_id', 'section_id', 'section_title', 'feedback']
    for field in required_fields:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400

    success = save_feedback(
        analysis_id=data['analysis_id'],
        section_id=data['section_id'],
        section_title=data['section_title'],
        feedback=data['feedback'],
        feedback_reason=data.get('feedback_reason'),
        user_correction=data.get('user_correction'),
        prompt_version=data.get('prompt_version', 1),
        metadata=data.get('metadata')
    )

    if success:
        return jsonify({'status': 'ok'})
    return jsonify({'error': 'Failed to save feedback'}), 500


@app.route('/api/analyses/search', methods=['GET'])
def search_analyses():
    """
    Search analyses by deal name or ID with optional filters.

    Query params:
        q: search query (deal name or ID)
        model: filter by analysis_type
        date_from: filter by date (YYYY-MM-DD)
        date_to: filter by date (YYYY-MM-DD)
        grouped: if 'true', group by deal_id and return newest first within each deal
    """
    from snowflake_service import get_connection

    query = request.args.get('q', '').strip()
    model_filter = request.args.get('model', '').strip()
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()
    grouped = request.args.get('grouped', 'true').lower() == 'true'

    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            # Build dynamic WHERE clause
            conditions = []
            params = []

            if query:
                conditions.append("(LOWER(a.deal_name) LIKE LOWER(%s) OR a.deal_id LIKE %s)")
                search_pattern = f'%{query}%'
                params.extend([search_pattern, search_pattern])

            if model_filter:
                conditions.append("a.analysis_type = %s")
                params.append(model_filter)

            if date_from:
                conditions.append("DATE(a.created_at) >= %s")
                params.append(date_from)

            if date_to:
                conditions.append("DATE(a.created_at) <= %s")
                params.append(date_to)

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            sql = f"""
                SELECT
                    a.analysis_id,
                    a.deal_id,
                    a.deal_name,
                    a.analysis_type,
                    at.name as type_name,
                    a.full_response,
                    a.created_at
                FROM ANALYSES a
                LEFT JOIN ANALYSIS_TYPES at ON a.analysis_type = at.type_id
                WHERE {where_clause}
                ORDER BY a.created_at DESC
                LIMIT 100
            """
            cursor.execute(sql, params)
            rows = cursor.fetchall()

            analyses = []
            for row in rows:
                analyses.append({
                    'analysis_id': row[0],
                    'deal_id': row[1],
                    'deal_name': row[2],
                    'analysis_type': row[3],
                    'type_name': row[4] or row[3],
                    'full_response': row[5],
                    'created_at': row[6].isoformat() if row[6] else None
                })

            if grouped:
                # Group analyses by deal_id, sorted by newest first within each deal
                grouped_deals = {}
                for analysis in analyses:
                    deal_id = analysis['deal_id']
                    if deal_id not in grouped_deals:
                        grouped_deals[deal_id] = {
                            'deal_id': deal_id,
                            'deal_name': analysis['deal_name'],
                            'analyses': [],
                            'latest_created_at': analysis['created_at']
                        }
                    grouped_deals[deal_id]['analyses'].append(analysis)

                # Sort deals by their most recent analysis
                sorted_deals = sorted(
                    grouped_deals.values(),
                    key=lambda d: d['latest_created_at'] or '',
                    reverse=True
                )

                return jsonify({'grouped': True, 'deals': sorted_deals})

            return jsonify({'grouped': False, 'analyses': analyses})

    except Exception as e:
        print(f"Error searching analyses: {e}")
        return jsonify({'grouped': False, 'analyses': []})


@app.route('/api/feedback-stats', methods=['GET'])
def get_feedback_stats():
    """
    Get feedback statistics per analysis type.

    Accuracy = (total_sections - negative_feedback) / total_sections
    Unresponded sections are assumed to be good (no negative feedback).
    """
    from snowflake_service import get_connection
    import re

    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            # Get all analyses with their responses to count sections
            analyses_sql = """
                SELECT
                    a.analysis_id,
                    a.analysis_type,
                    at.name as type_name,
                    a.full_response
                FROM ANALYSES a
                LEFT JOIN ANALYSIS_TYPES at ON a.analysis_type = at.type_id
            """
            cursor.execute(analyses_sql)
            analyses = cursor.fetchall()

            # Get negative feedback counts per analysis
            feedback_sql = """
                SELECT
                    analysis_id,
                    COUNT(*) as negative_count
                FROM FEEDBACK
                WHERE feedback = 'down' AND section_id != 'overall'
                GROUP BY analysis_id
            """
            cursor.execute(feedback_sql)
            feedback_rows = cursor.fetchall()

            # Build lookup of negative feedback per analysis
            negative_by_analysis = {row[0]: row[1] for row in feedback_rows}

            # Aggregate stats by analysis type
            type_stats = {}
            for row in analyses:
                analysis_id = row[0]
                analysis_type = row[1]
                type_name = row[2] or analysis_type
                full_response = row[3] or ''

                # Count sections (h2 headers) in the response
                section_count = len(re.findall(r'^## ', full_response, re.MULTILINE))
                if section_count == 0:
                    continue  # Skip analyses with no sections

                negative_count = negative_by_analysis.get(analysis_id, 0)

                if analysis_type not in type_stats:
                    type_stats[analysis_type] = {
                        'name': type_name,
                        'total_sections': 0,
                        'negative_feedback': 0,
                        'analysis_count': 0
                    }

                type_stats[analysis_type]['total_sections'] += section_count
                type_stats[analysis_type]['negative_feedback'] += negative_count
                type_stats[analysis_type]['analysis_count'] += 1

            # Calculate accuracy for each type
            stats = []
            for type_id, data in type_stats.items():
                total = data['total_sections']
                negative = data['negative_feedback']
                # Accuracy = (total - negative) / total * 100
                accuracy = round(((total - negative) / total * 100) if total > 0 else 100)
                stats.append({
                    'type_id': type_id,
                    'name': data['name'],
                    'total_sections': total,
                    'negative_feedback': negative,
                    'analysis_count': data['analysis_count'],
                    'accuracy': accuracy
                })

            # Sort by analysis count (most used first)
            stats.sort(key=lambda x: x['analysis_count'], reverse=True)

            return jsonify(stats)

    except Exception as e:
        print(f"Error fetching feedback stats: {e}")
        return jsonify([])


if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)

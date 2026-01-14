# Backend Deployment Guide

This Flask backend serves as middleware between the Chrome extension and Snowflake database.

## Overview

- **Language**: Python 3.9+
- **Framework**: Flask
- **Database**: Snowflake
- **Purpose**: Stores and retrieves deal analyses, feedback, and analysis type configurations

## Prerequisites

- Python 3.9 or higher
- Access to Snowflake with appropriate permissions
- Kubernetes cluster access (for deployment)

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `SNOWFLAKE_ACCOUNT` | Yes | Snowflake account identifier (e.g., `RW53250-HQ45752`) |
| `SNOWFLAKE_USER` | Yes | Snowflake username (email) |
| `SNOWFLAKE_ROLE` | Yes | Snowflake role with access to the schema |
| `SNOWFLAKE_PAT` | Yes | Snowflake Personal Access Token |
| `SNOWFLAKE_WAREHOUSE` | Yes | Snowflake warehouse name |
| `SNOWFLAKE_DATABASE` | Yes | Snowflake database name |
| `SNOWFLAKE_SCHEMA` | Yes | Schema name (default: `CHROME_EXTENSION_FEEDBACK`) |
| `PORT` | No | Server port (default: `5001`) |
| `FLASK_DEBUG` | No | Enable debug mode (default: `false`) |

## Local Development

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your credentials
python server.py
```

Server will start at `http://localhost:5001`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/analysis-types` | GET | List available analysis types |
| `/api/analyses` | POST | Save a new analysis |
| `/api/analyses/search` | GET | Search/filter past analyses |
| `/api/feedback` | POST | Submit feedback for an analysis |
| `/api/feedback-stats` | GET | Get feedback statistics |

## Kubernetes Deployment

### Docker Build

The app can be containerized with a simple Dockerfile:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001

CMD ["python", "server.py"]
```

### Required Kubernetes Secrets

Create a secret with the Snowflake credentials:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: hubspot-analyzer-secrets
type: Opaque
stringData:
  SNOWFLAKE_ACCOUNT: "your_account"
  SNOWFLAKE_USER: "your.email@company.com"
  SNOWFLAKE_ROLE: "YOUR_ROLE"
  SNOWFLAKE_PAT: "your_pat_token"
  SNOWFLAKE_WAREHOUSE: "YOUR_WAREHOUSE"
  SNOWFLAKE_DATABASE: "YOUR_DATABASE"
  SNOWFLAKE_SCHEMA: "CHROME_EXTENSION_FEEDBACK"
```

### Health Check

Use `/api/health` endpoint for liveness/readiness probes:

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 5001
  initialDelaySeconds: 10
  periodSeconds: 30
readinessProbe:
  httpGet:
    path: /api/health
    port: 5001
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Post-Deployment Steps

After the backend is deployed and accessible:

1. **Note the deployed URL** (e.g., `https://hubspot-analyzer.internal.hqo.co`)

2. **Update the Chrome extension** - see `POST_DEPLOYMENT.md` in the root directory

## Snowflake Schema

The backend expects these tables in the configured schema:

### ANALYSIS_TYPES
```sql
CREATE TABLE ANALYSIS_TYPES (
    type_id VARCHAR PRIMARY KEY,
    name VARCHAR,
    description VARCHAR,
    system_prompt TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### ANALYSES
```sql
CREATE TABLE ANALYSES (
    analysis_id VARCHAR PRIMARY KEY,
    deal_id VARCHAR,
    deal_name VARCHAR,
    analysis_type VARCHAR REFERENCES ANALYSIS_TYPES(type_id),
    full_response TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### FEEDBACK
```sql
CREATE TABLE FEEDBACK (
    feedback_id VARCHAR PRIMARY KEY,
    analysis_id VARCHAR REFERENCES ANALYSES(analysis_id),
    section_name VARCHAR,
    feedback_type VARCHAR,  -- 'positive' or 'negative'
    feedback_reason TEXT,
    is_overall BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

## Troubleshooting

### Connection Issues
- Verify Snowflake credentials are correct
- Check that the PAT hasn't expired
- Ensure the role has access to the schema

### CORS Errors
- The server enables CORS for all origins by default
- For production, consider restricting to specific Chrome extension IDs

## Contact

For deployment assistance, contact the platform team.

# HqO HubSpot Deal Analyzer

A Chrome extension that provides AI-powered deal analysis directly in your browser, with feedback tracking and historical analysis storage.

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  Chrome Extension   │────▶│   Flask Backend     │────▶│   Snowflake     │
│  (Side Panel UI)    │     │   (API Middleware)  │     │   (Database)    │
└─────────────────────┘     └─────────────────────┘     └─────────────────┘
         │
         │ Direct API calls
         ▼
┌─────────────────────┐
│   HubSpot API       │
│   Claude API        │
└─────────────────────┘
```

## Features

- **Side Panel UI** - Opens alongside HubSpot for seamless workflow
- **Multiple Analysis Types** - GTM, Pod Review, Challenger Sales, Win-back
- **Auto URL Detection** - Detects deal from current tab
- **Feedback System** - Rate analyses and individual sections
- **Historical Lookup** - Browse past analyses with filters
- **Model Accuracy Tracking** - See which analysis types perform best

## Setup

### Prerequisites

- Chrome browser
- Backend deployed (see `backend/DEPLOYMENT.md`)
- HubSpot Private App token
- Claude API key

### Installation

1. **Load the Extension** (Developer Mode):
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select this folder (not the `backend/` subfolder)

2. **Configure API Keys**:
   - Right-click extension icon → Options
   - Enter HubSpot token and Claude API key
   - Save

### Getting API Keys

**HubSpot Private App Token:**
1. HubSpot Settings → Integrations → Private Apps
2. Create new app with scopes:
   - `crm.objects.deals.read`
   - `crm.objects.contacts.read`
   - `crm.objects.companies.read`
   - `sales-email-read`
3. Copy the access token

**Claude API Key:**
1. Go to https://console.anthropic.com/settings/keys
2. Create and copy key (starts with `sk-ant-`)

## Usage

1. Navigate to any HubSpot deal page
2. Click the extension icon to open the side panel
3. Deal URL auto-detects (or paste manually)
4. Select analysis type
5. Click "Analyze Deal"
6. Provide feedback to improve model accuracy

## Project Structure

```
├── backend/                 # Flask API server (deploy separately)
│   ├── server.py           # API endpoints
│   ├── snowflake_service.py # Database operations
│   ├── requirements.txt    # Python dependencies
│   ├── Dockerfile          # Container build
│   └── DEPLOYMENT.md       # Deployment guide
│
├── sidepanel.html          # Main UI
├── sidepanel.js            # Main logic (BACKEND_URL configured here)
├── sidepanel.css           # Styles
├── hubspot-client.js       # HubSpot & Claude API client
├── analysis-types.js       # Prompt configurations
├── manifest.json           # Extension manifest
├── background.js           # Service worker
├── options.html            # Settings page
├── popup.js                # Legacy popup (side panel preferred)
├── popup.html/css          # Legacy popup UI
├── icons/                  # Extension icons
└── lib/                    # Third-party (marked.js)
```

## Configuration

After backend deployment, update these files:

1. **`sidepanel.js`** - Set `BACKEND_URL` to deployed URL
2. **`manifest.json`** - Add backend URL to `host_permissions`

See `POST_DEPLOYMENT.md` for detailed instructions.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "API keys not configured" | Go to Options and add keys |
| "Error connecting to server" | Check backend URL and deployment |
| "Could not fetch deal" | Verify HubSpot token has required scopes |
| Analysis types not loading | Backend may be down, check `/api/health` |

## Security

- API keys stored in Chrome's local storage
- Keys only sent to official HubSpot/Claude APIs
- Backend credentials stored as K8s secrets
- No credentials committed to repo

## Development

**Run backend locally:**
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # Configure credentials
python server.py
```

**Test extension:**
- Load unpacked in Chrome
- Backend URL defaults to `localhost:5001`

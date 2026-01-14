# Post-Deployment Configuration

After the backend is deployed to Kubernetes, follow these steps to configure the Chrome extension.

## Required Changes

### 1. Update Backend URL in Extension

Once you have the deployed backend URL, update it in `sidepanel.js`:

**File:** `sidepanel.js` (line ~34)

```javascript
// Change from:
const BACKEND_URL = 'http://localhost:5001';

// Change to:
const BACKEND_URL = 'https://your-deployed-backend-url.hqo.co';
```

### 2. Configure API Keys

Users need to configure their API keys via the extension's options page:

1. Right-click the extension icon → **Options**
2. Enter:
   - **HubSpot API Token**: Personal access token from HubSpot
   - **Claude API Key**: Anthropic API key

Alternatively, for org-wide deployment, you can set default keys in `sidepanel.js` and `popup.js`:

```javascript
const HARDCODED_SETTINGS = {
  hubspotToken: "your-org-hubspot-token",
  claudeApiKey: "your-org-claude-api-key"
};
```

**Note:** If setting org-wide keys, ensure they are stored securely and rotated regularly.

## Chrome Extension Distribution

### Option A: Chrome Web Store (Recommended for org distribution)

1. Zip the extension files (excluding `backend/` folder):
   ```bash
   zip -r extension.zip . -x "backend/*" -x ".git/*" -x "*.md" -x ".env*" -x ".DS_Store"
   ```

2. Upload to Chrome Web Store Developer Dashboard
3. Set visibility to "Unlisted" for internal org use
4. Share the direct install link with team members

### Option B: Developer Mode (For testing)

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the extension folder (not the backend folder)

## Verification Checklist

After deployment, verify:

- [ ] Backend health endpoint responds: `GET /api/health`
- [ ] Analysis types load in extension dropdown
- [ ] Can run an analysis on a HubSpot deal
- [ ] Analysis is saved and appears in "Browse Previous Analyses"
- [ ] Feedback submission works
- [ ] Model accuracy stats display correctly

## File Structure Reference

```
Hubspot-Deal-Analysis-Extension/
├── backend/                    # Deploy to Kubernetes
│   ├── server.py              # Flask application
│   ├── snowflake_service.py   # Database operations
│   ├── requirements.txt       # Python dependencies
│   ├── .env.example          # Environment template
│   └── DEPLOYMENT.md         # Backend deployment guide
│
├── sidepanel.js              # Main extension logic (UPDATE BACKEND_URL)
├── sidepanel.html            # Side panel UI
├── sidepanel.css             # Side panel styles
├── hubspot-client.js         # HubSpot API client
├── analysis-types.js         # Analysis type definitions
├── manifest.json             # Extension manifest
├── background.js             # Service worker
├── popup.js                  # Popup logic
├── popup.html                # Popup UI
├── popup.css                 # Popup styles
├── options.html              # Settings page
├── icons/                    # Extension icons
└── lib/                      # Third-party libraries
```

## Support

For issues:
- Backend deployment: Contact platform team
- Extension functionality: Check browser console for errors
- Snowflake access: Contact data team

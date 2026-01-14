# HubSpot Deal Analyzer - Chrome Extension

A Chrome extension version of the HubSpot Deal Analyzer that provides AI-powered deal insights directly in your browser.

## Installation

1. **Create Icons** (required):
   The extension needs PNG icons. Create these files in the `icons/` folder:
   - `icon16.png` (16x16 pixels)
   - `icon48.png` (48x48 pixels)
   - `icon128.png` (128x128 pixels)

   You can use any image editor or online tool to create simple icons, or use a service like:
   - https://favicon.io/favicon-converter/

2. **Load the Extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select this `chrome_extension` folder

3. **Configure API Keys**:
   - Click the extension icon in Chrome
   - Click "Configure Settings" or right-click the extension icon > "Options"
   - Enter your HubSpot API token and Claude API key
   - Click "Save Settings"

## Getting API Keys

### HubSpot Private App Token
1. Go to HubSpot Settings > Integrations > Private Apps
2. Create a new private app
3. Add these scopes:
   - `crm.objects.deals.read`
   - `crm.objects.contacts.read`
   - `crm.objects.companies.read`
   - `sales-email-read` (for email engagements)
4. Copy the access token

### Claude API Key
1. Go to https://console.anthropic.com/settings/keys
2. Create a new API key
3. Copy the key (starts with `sk-ant-`)

## Usage

1. Navigate to a HubSpot deal page in your browser
2. Click the extension icon
3. The deal URL should auto-detect (or paste it manually)
4. Select analysis type:
   - **GTM Analysis**: For closed-won deals - extracts buying triggers and outreach angles
   - **Pod Deal Analysis**: For active deals - identifies risks and reframe opportunities
5. Click "Analyze Deal"
6. View results and copy to clipboard

## Features

- Auto-detects HubSpot deal URLs from the current tab
- Two analysis types optimized for different sales workflows
- Markdown-formatted results
- Copy analysis to clipboard
- Secure local storage of API credentials

## Files

```
chrome_extension/
├── manifest.json        # Extension configuration
├── popup.html          # Main popup UI
├── popup.css           # Popup styles
├── popup.js            # Popup logic
├── options.html        # Settings page
├── analysis-types.js   # Claude prompt configurations
├── hubspot-client.js   # HubSpot API client
├── lib/
│   └── marked.min.js   # Markdown parser
└── icons/
    ├── icon16.png      # (you need to create)
    ├── icon48.png      # (you need to create)
    └── icon128.png     # (you need to create)
```

## Troubleshooting

**"API keys not configured"**
- Go to extension options and add your API keys

**"Could not fetch deal"**
- Check that your HubSpot token has the required scopes
- Verify the deal URL is correct

**"Claude API error"**
- Verify your Claude API key is valid
- Check you have sufficient API credits

## Security Note

API keys are stored in Chrome's sync storage. They are not transmitted anywhere except to the official HubSpot and Claude APIs. For enhanced security, you may want to:
- Use a dedicated HubSpot private app with minimal scopes
- Set up API key rotation
- Use a separate Claude API key for this extension

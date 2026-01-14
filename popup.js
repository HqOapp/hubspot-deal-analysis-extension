/**
 * HubSpot Deal Analyzer - Popup Main Logic
 */

// DOM Elements
const settingsWarning = document.getElementById('settingsWarning');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const formSection = document.getElementById('formSection');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const errorMessage = document.getElementById('errorMessage');
const dealUrlInput = document.getElementById('dealUrl');
const analysisTypeSelect = document.getElementById('analysisType');
const analysisDescription = document.getElementById('analysisDescription');
const analyzeBtn = document.getElementById('analyzeBtn');
const detectUrlBtn = document.getElementById('detectUrlBtn');
const loadingStatus = document.getElementById('loadingStatus');
const resultTitle = document.getElementById('resultTitle');
const resultMeta = document.getElementById('resultMeta');
const analysisContent = document.getElementById('analysisContent');
const copyBtn = document.getElementById('copyBtn');
const newAnalysisBtn = document.getElementById('newAnalysisBtn');

// State
let currentResult = null;

// Hardcoded API keys (for personal use only)
const HARDCODED_SETTINGS = {
  hubspotToken: "pat-na2-6b8ee488-a12b-4205-addb-e37b95dfa9ed",
  claudeApiKey: "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"
};

// Analysis type descriptions
const analysisDescriptions = {
  gtm: "Closed-won deal analysis for GTM insights (Aha Moments, OSINT signals, outreach angles)",
  pod: "Active deal risk assessment for sales pod reviews",
  challenger: "Challenger Sales methodology evaluation with Teach, Tailor, Take Control tactics",
  winback: "Closed-lost deal post-mortem with win-back strategy assessment"
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkSettings();
  setupEventListeners();
  await tryAutoDetectUrl();
});

async function checkSettings() {
  // Use hardcoded settings - always valid
  settingsWarning.classList.remove('active');
  analyzeBtn.disabled = false;
}

function setupEventListeners() {
  // Analysis type change
  analysisTypeSelect.addEventListener('change', () => {
    analysisDescription.textContent = analysisDescriptions[analysisTypeSelect.value] || '';
  });

  // Open settings
  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Detect URL from current tab
  detectUrlBtn.addEventListener('click', tryAutoDetectUrl);

  // Analyze button
  analyzeBtn.addEventListener('click', runAnalysis);

  // Copy to clipboard
  copyBtn.addEventListener('click', copyToClipboard);

  // New analysis
  newAnalysisBtn.addEventListener('click', resetForm);
}

async function tryAutoDetectUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && tab.url.includes('hubspot.com')) {
      const dealId = extractDealId(tab.url);
      if (dealId) {
        dealUrlInput.value = tab.url;
      }
    }
  } catch (error) {
    console.log('Could not auto-detect URL:', error);
  }
}

function extractDealId(url) {
  if (!url) return null;

  const urlPath = url.split('?')[0];
  const patterns = [
    /\/record\/0-3\/(\d+)/,
    /\/deal\/(\d+)/,
    /\/(\d{10,})/
  ];

  for (const pattern of patterns) {
    const match = urlPath.match(pattern);
    if (match) return match[1];
  }

  const segments = urlPath.replace(/\/$/, '').split('/');
  if (segments.length && /^\d+$/.test(segments[segments.length - 1])) {
    return segments[segments.length - 1];
  }

  return null;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('active');
}

function hideError() {
  errorMessage.classList.remove('active');
}

function setLoadingStatus(status) {
  loadingStatus.textContent = status;
}

function showLoading() {
  hideError();
  formSection.style.display = 'none';
  loadingSection.classList.add('active');
  resultsSection.classList.remove('active');
}

function hideLoading() {
  loadingSection.classList.remove('active');
}

function showResults() {
  hideLoading();
  resultsSection.classList.add('active');
}

function showForm() {
  hideLoading();
  resultsSection.classList.remove('active');
  formSection.style.display = 'block';
}

async function runAnalysis() {
  const url = dealUrlInput.value.trim();
  const analysisType = analysisTypeSelect.value;

  if (!url) {
    showError('Please enter a HubSpot deal URL');
    return;
  }

  const dealId = extractDealId(url);
  if (!dealId) {
    showError('Could not extract deal ID from URL. Please check the URL format.');
    return;
  }

  // Use hardcoded API keys
  const settings = HARDCODED_SETTINGS;

  showLoading();

  try {
    // Fetch deal data
    setLoadingStatus('Fetching deal from HubSpot...');
    const client = new HubSpotClient(settings.hubspotToken, dealId);

    const deal = await client.getDeal();
    if (!deal) {
      throw new Error('Could not fetch deal. Please check the URL and your access permissions.');
    }

    const dealName = deal.properties?.dealname || 'Unknown Deal';

    // Fetch associated data
    setLoadingStatus('Fetching contacts and companies...');
    const [contacts, companies] = await Promise.all([
      client.getContacts(),
      client.getCompanies()
    ]);

    setLoadingStatus('Fetching deal activities...');
    const engagements = await client.getAllEngagements();
    const collectedUrls = collectAllUrls(engagements);

    // Format for Claude
    setLoadingStatus('Preparing data for analysis...');
    const dealContent = formatDealForClaude(deal, contacts, companies, engagements, collectedUrls);

    // Run Claude analysis
    setLoadingStatus('Running AI analysis (this may take a moment)...');
    const analysis = await analyzeWithClaude(settings.claudeApiKey, dealContent, analysisType);

    // Store result
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    currentResult = {
      dealId,
      dealName,
      analysisType,
      analysisTypeName: ANALYSIS_TYPES[analysisType].name,
      analysis,
      timestamp
    };

    // Display results
    resultTitle.textContent = `${currentResult.analysisTypeName}: ${dealName}`;
    resultMeta.textContent = `Deal ID: ${dealId} | Generated: ${timestamp}`;
    analysisContent.innerHTML = marked.parse(analysis);

    showResults();

  } catch (error) {
    showForm();
    showError(error.message);
    console.error('Analysis error:', error);
  }
}

async function copyToClipboard() {
  if (!currentResult) return;

  const text = `# ${currentResult.analysisTypeName}: ${currentResult.dealName}\n\n*Generated on ${currentResult.timestamp}*\n\n---\n\n${currentResult.analysis}`;

  try {
    await navigator.clipboard.writeText(text);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  } catch (error) {
    console.error('Copy failed:', error);
    showError('Failed to copy to clipboard');
  }
}

function resetForm() {
  resultsSection.classList.remove('active');
  formSection.style.display = 'block';
  dealUrlInput.value = '';
  currentResult = null;
  hideError();
}

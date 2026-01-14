/**
 * HubSpot Deal Analyzer - Side Panel Main Logic
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
let analysisTypes = []; // Loaded from backend
let parsedSections = []; // Parsed sections from analysis
let sectionFeedbackState = {}; // Track which sections have been submitted
let currentModalSection = null; // Track which section the modal is for (null = section, 'overall' = overall feedback)
let overallFeedbackSubmitted = false; // Track if overall feedback has been submitted
let lookupResults = []; // Results from analysis lookup

// Backend URL for Snowflake operations
const BACKEND_URL = 'https://hubspot-deal-analysis-extension-production.up.railway.app';

// API keys - configure via extension options page
const HARDCODED_SETTINGS = {
  hubspotToken: "",
  claudeApiKey: ""
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadAnalysisTypes();
  await loadFeedbackStats();
  await checkSettings();
  setupEventListeners();
  setupModalListeners();
  await tryAutoDetectUrl();
});

async function loadAnalysisTypes() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/analysis-types`);
    if (!response.ok) {
      throw new Error('Failed to fetch analysis types');
    }
    analysisTypes = await response.json();

    // Populate dropdown
    analysisTypeSelect.innerHTML = '';
    analysisTypes.forEach((type, index) => {
      const option = document.createElement('option');
      option.value = type.type_id;
      option.textContent = type.name;
      analysisTypeSelect.appendChild(option);
    });

    // Set initial description
    if (analysisTypes.length > 0) {
      analysisDescription.textContent = analysisTypes[0].description || '';
    }
  } catch (error) {
    console.error('Failed to load analysis types from backend:', error);
    // Show error in dropdown
    analysisTypeSelect.innerHTML = '<option value="">Failed to load - check backend</option>';
    analyzeBtn.disabled = true;
  }
}

async function loadFeedbackStats() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/feedback-stats`);
    if (!response.ok) return;

    const stats = await response.json();
    renderFeedbackStats(stats);
  } catch (error) {
    console.log('Could not load feedback stats:', error);
  }
}

function renderFeedbackStats(stats) {
  const statsGrid = document.getElementById('statsGrid');
  const statsContainer = document.getElementById('feedbackStats');

  if (!stats || stats.length === 0) {
    statsContainer.style.display = 'none';
    return;
  }

  statsContainer.style.display = 'block';

  const html = stats.slice(0, 4).map(stat => {
    const accuracy = stat.accuracy ?? 0;
    const negativeFeedback = stat.negative_feedback ?? 0;
    const totalSections = stat.total_sections ?? 0;
    const name = stat.name ?? 'Unknown';
    const barClass = accuracy >= 70 ? 'good' : '';
    return `
      <div class="stat-card">
        <div class="stat-card-name">${name}</div>
        <div class="stat-percentage">${accuracy}%</div>
        <div class="stat-bar">
          <div class="stat-bar-fill ${barClass}" style="width: ${accuracy}%"></div>
        </div>
        <div class="stat-count">${negativeFeedback} issues / ${totalSections} sections</div>
      </div>
    `;
  }).join('');

  statsGrid.innerHTML = html;
}

async function checkSettings() {
  // Use hardcoded settings - always valid
  settingsWarning.classList.remove('active');
  if (analysisTypes.length > 0) {
    analyzeBtn.disabled = false;
  }
}

function setupEventListeners() {
  // Analysis type change
  analysisTypeSelect.addEventListener('change', () => {
    const selectedType = analysisTypes.find(t => t.type_id === analysisTypeSelect.value);
    analysisDescription.textContent = selectedType?.description || '';
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

  // Overall feedback trigger button - opens modal
  document.getElementById('overallFeedbackTrigger').addEventListener('click', openOverallFeedbackModal);

  // Lookup button and modal
  document.getElementById('lookupBtn').addEventListener('click', openLookupModal);
  document.getElementById('lookupModalClose').addEventListener('click', closeLookupModal);
  document.getElementById('lookupModal').addEventListener('click', (e) => {
    if (e.target.id === 'lookupModal') closeLookupModal();
  });
  document.getElementById('lookupSearch').addEventListener('input', debounce(searchAnalyses, 300));

  // Filter controls for lookup modal
  document.getElementById('lookupModelFilter').addEventListener('change', searchAnalyses);
  document.getElementById('lookupDateFrom').addEventListener('change', searchAnalyses);
  document.getElementById('lookupDateTo').addEventListener('change', searchAnalyses);

  // Help button and modal
  document.getElementById('helpBtn').addEventListener('click', openHelpModal);
  document.getElementById('helpModalClose').addEventListener('click', closeHelpModal);
  document.getElementById('helpModal').addEventListener('click', (e) => {
    if (e.target.id === 'helpModal') closeHelpModal();
  });
}

// Help Modal Functions
function openHelpModal() {
  document.getElementById('helpModal').classList.add('active');
}

function closeHelpModal() {
  document.getElementById('helpModal').classList.remove('active');
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
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

// Lookup Modal Functions
let groupedDeals = []; // Store grouped deals for lookup

function openLookupModal() {
  document.getElementById('lookupModal').classList.add('active');
  document.getElementById('lookupSearch').value = '';
  document.getElementById('lookupModelFilter').value = '';
  document.getElementById('lookupDateFrom').value = '';
  document.getElementById('lookupDateTo').value = '';

  // Populate model filter dropdown with available analysis types
  populateModelFilter();

  // Load recent analyses immediately
  searchAnalyses();
}

function populateModelFilter() {
  const select = document.getElementById('lookupModelFilter');
  select.innerHTML = '<option value="">All Models</option>';
  analysisTypes.forEach(type => {
    const option = document.createElement('option');
    option.value = type.type_id;
    option.textContent = type.name;
    select.appendChild(option);
  });
}

function closeLookupModal() {
  document.getElementById('lookupModal').classList.remove('active');
}

async function searchAnalyses() {
  const query = document.getElementById('lookupSearch').value.trim();
  const modelFilter = document.getElementById('lookupModelFilter').value;
  const dateFrom = document.getElementById('lookupDateFrom').value;
  const dateTo = document.getElementById('lookupDateTo').value;
  const resultsContainer = document.getElementById('lookupResults');

  try {
    // Build URL with all filter params
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (modelFilter) params.append('model', modelFilter);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    params.append('grouped', 'true');

    const url = `${BACKEND_URL}/api/analyses/search?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      resultsContainer.innerHTML = '<p class="lookup-empty">Error loading analyses</p>';
      return;
    }

    const data = await response.json();

    if (data.grouped && data.deals) {
      groupedDeals = data.deals;
      if (groupedDeals.length === 0) {
        resultsContainer.innerHTML = query || modelFilter || dateFrom || dateTo
          ? '<p class="lookup-empty">No analyses found matching your filters</p>'
          : '<p class="lookup-empty">No analyses found</p>';
        return;
      }
      renderGroupedLookupResults();
    } else {
      // Fallback for non-grouped response
      lookupResults = data.analyses || [];
      if (lookupResults.length === 0) {
        resultsContainer.innerHTML = '<p class="lookup-empty">No analyses found</p>';
        return;
      }
      renderLookupResults();
    }

  } catch (error) {
    console.error('Error searching analyses:', error);
    resultsContainer.innerHTML = '<p class="lookup-empty">Error connecting to server</p>';
  }
}

function renderGroupedLookupResults() {
  const resultsContainer = document.getElementById('lookupResults');

  const html = groupedDeals.map((deal, dealIndex) => {
    const analysisCount = deal.analyses.length;
    const latestAnalysis = deal.analyses[0]; // Already sorted newest first
    const latestDate = new Date(latestAnalysis.created_at);
    const formattedDate = latestDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    // If only one analysis, render as simple item
    if (analysisCount === 1) {
      const analysis = deal.analyses[0];
      const date = new Date(analysis.created_at);
      const fullDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
      return `
        <div class="lookup-item" data-deal-index="${dealIndex}" data-analysis-index="0">
          <div class="lookup-item-info">
            <div class="lookup-item-name">${analysis.deal_name || 'Unknown Deal'}</div>
            <div class="lookup-item-meta">Deal ${analysis.deal_id} • ${fullDate}</div>
          </div>
          <span class="lookup-item-type">${analysis.type_name}</span>
        </div>
      `;
    }

    // Multiple analyses - render as expandable group
    const analysisItems = deal.analyses.map((analysis, analysisIndex) => {
      const date = new Date(analysis.created_at);
      const fullDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
      return `
        <div class="lookup-subitem" data-deal-index="${dealIndex}" data-analysis-index="${analysisIndex}">
          <div class="lookup-subitem-info">
            <span class="lookup-subitem-type">${analysis.type_name}</span>
            <span class="lookup-subitem-date">${fullDate}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="lookup-group" data-deal-index="${dealIndex}">
        <div class="lookup-group-header">
          <div class="lookup-group-info">
            <div class="lookup-group-name">${deal.deal_name || 'Unknown Deal'}</div>
            <div class="lookup-group-meta">Deal ${deal.deal_id} • ${formattedDate}</div>
          </div>
          <div class="lookup-group-right">
            <span class="lookup-group-count">${analysisCount} analyses</span>
            <span class="lookup-group-chevron">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </span>
          </div>
        </div>
        <div class="lookup-group-items">
          ${analysisItems}
        </div>
      </div>
    `;
  }).join('');

  resultsContainer.innerHTML = html;

  // Add click handlers for group headers (expand/collapse)
  resultsContainer.querySelectorAll('.lookup-group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      const group = header.closest('.lookup-group');
      group.classList.toggle('expanded');
    });
  });

  // Add click handlers for individual analysis items
  resultsContainer.querySelectorAll('.lookup-item').forEach(item => {
    item.addEventListener('click', () => {
      const dealIndex = parseInt(item.dataset.dealIndex);
      const analysisIndex = parseInt(item.dataset.analysisIndex);
      viewGroupedAnalysis(dealIndex, analysisIndex);
    });
  });

  // Add click handlers for sub-items within groups
  resultsContainer.querySelectorAll('.lookup-subitem').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent group header toggle
      const dealIndex = parseInt(item.dataset.dealIndex);
      const analysisIndex = parseInt(item.dataset.analysisIndex);
      viewGroupedAnalysis(dealIndex, analysisIndex);
    });
  });
}

function viewGroupedAnalysis(dealIndex, analysisIndex) {
  const deal = groupedDeals[dealIndex];
  if (!deal) return;
  const analysis = deal.analyses[analysisIndex];
  if (!analysis) return;

  // Use the existing viewLookupAnalysis logic but with the analysis directly
  closeLookupModal();

  const date = new Date(analysis.created_at);
  const timestamp = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  currentResult = {
    dealId: analysis.deal_id,
    dealName: analysis.deal_name,
    analysisType: analysis.analysis_type,
    analysisTypeName: analysis.type_name,
    analysis: analysis.full_response,
    timestamp: timestamp,
    analysisId: analysis.analysis_id
  };

  resultTitle.textContent = `${analysis.type_name}: ${analysis.deal_name}`;
  resultMeta.textContent = `Deal ID: ${analysis.deal_id} | Generated: ${timestamp}`;

  parsedSections = parseAnalysisSections(analysis.full_response);
  renderAnalysisWithFeedback(parsedSections);

  // Mark as historical (disable feedback)
  overallFeedbackSubmitted = true;
  const overallTrigger = document.getElementById('overallFeedbackTrigger');
  overallTrigger.classList.add('submitted');
  overallTrigger.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 8v4l3 3"></path>
      <circle cx="12" cy="12" r="10"></circle>
    </svg>
    Historical
  `;

  sectionFeedbackState = {};
  document.querySelectorAll('.section-feedback-trigger').forEach(btn => {
    btn.classList.add('submitted');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 8v4l3 3"></path>
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      Historical
    `;
  });

  showResults();
}

function renderLookupResults() {
  const resultsContainer = document.getElementById('lookupResults');

  const html = lookupResults.map((analysis, index) => {
    const date = new Date(analysis.created_at);
    const formattedDate = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });

    return `
      <div class="lookup-item" data-index="${index}">
        <div class="lookup-item-info">
          <div class="lookup-item-name">${analysis.deal_name || 'Unknown Deal'}</div>
          <div class="lookup-item-meta">Deal ${analysis.deal_id} • ${formattedDate}</div>
        </div>
        <span class="lookup-item-type">${analysis.type_name}</span>
      </div>
    `;
  }).join('');

  resultsContainer.innerHTML = html;

  // Add click handlers
  resultsContainer.querySelectorAll('.lookup-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      viewLookupAnalysis(index);
    });
  });
}

function viewLookupAnalysis(index) {
  const analysis = lookupResults[index];
  if (!analysis) return;

  // Close the lookup modal
  closeLookupModal();

  // Format the date
  const date = new Date(analysis.created_at);
  const timestamp = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  // Set current result (for copy functionality)
  currentResult = {
    dealId: analysis.deal_id,
    dealName: analysis.deal_name,
    analysisType: analysis.analysis_type,
    analysisTypeName: analysis.type_name,
    analysis: analysis.full_response,
    timestamp: timestamp,
    analysisId: analysis.analysis_id
  };

  // Display results
  resultTitle.textContent = `${analysis.type_name}: ${analysis.deal_name}`;
  resultMeta.textContent = `Deal ID: ${analysis.deal_id} | Generated: ${timestamp}`;

  // Parse sections and render with feedback buttons
  parsedSections = parseAnalysisSections(analysis.full_response);
  renderAnalysisWithFeedback(parsedSections);

  // Reset overall feedback UI (viewing historical, so disable feedback)
  overallFeedbackSubmitted = true; // Mark as submitted to disable feedback
  const overallTrigger = document.getElementById('overallFeedbackTrigger');
  overallTrigger.classList.add('submitted');
  overallTrigger.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 8v4l3 3"></path>
      <circle cx="12" cy="12" r="10"></circle>
    </svg>
    Historical
  `;

  // Disable section feedback for historical views
  sectionFeedbackState = {};
  document.querySelectorAll('.section-feedback-trigger').forEach(btn => {
    btn.classList.add('submitted');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 8v4l3 3"></path>
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      Historical
    `;
  });

  showResults();
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

    // Get the selected analysis type from backend data
    const selectedAnalysisType = analysisTypes.find(t => t.type_id === analysisType);
    if (!selectedAnalysisType) {
      throw new Error('Selected analysis type not found');
    }

    // Run Claude analysis using system prompt from Snowflake
    setLoadingStatus('Running AI analysis (this may take a moment)...');
    const analysis = await analyzeWithClaudeCustomPrompt(
      settings.claudeApiKey,
      dealContent,
      selectedAnalysisType.system_prompt
    );

    // Store result
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    currentResult = {
      dealId,
      dealName,
      analysisType,
      analysisTypeName: selectedAnalysisType.name,
      analysis,
      timestamp,
      analysisId: null
    };

    // Display results
    resultTitle.textContent = `${currentResult.analysisTypeName}: ${dealName}`;
    resultMeta.textContent = `Deal ID: ${dealId} | Generated: ${timestamp}`;

    // Parse sections and render with feedback buttons
    parsedSections = parseAnalysisSections(analysis);
    renderAnalysisWithFeedback(parsedSections);

    // Reset overall feedback UI
    overallFeedbackSubmitted = false;
    const overallTrigger = document.getElementById('overallFeedbackTrigger');
    overallTrigger.classList.remove('submitted', 'positive', 'negative');
    overallTrigger.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      Rate Analysis
    `;

    showResults();

    // Save to Snowflake (non-blocking)
    saveAnalysisToBackend(currentResult, dealContent, selectedAnalysisType.system_prompt).then(analysisId => {
      if (analysisId) {
        currentResult.analysisId = analysisId;
        console.log('Analysis saved to Snowflake:', analysisId);
      }
    });

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

// Snowflake Backend Functions

async function saveAnalysisToBackend(result, userInput, systemPrompt) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deal_id: result.dealId,
        deal_name: result.dealName,
        analysis_type: result.analysisType,
        user_input: userInput,
        system_prompt: systemPrompt,
        full_response: result.analysis,
        prompt_version: 1,
        metadata: { source: 'chrome_extension' }
      })
    });

    if (!response.ok) {
      console.warn('Failed to save analysis to Snowflake:', await response.text());
      return null;
    }

    const data = await response.json();
    return data.analysis_id;
  } catch (error) {
    console.warn('Could not connect to backend for analysis save:', error.message);
    return null;
  }
}

async function submitFeedbackToBackend(analysisId, sectionId, sectionTitle, feedback, reason = null) {
  if (!analysisId) {
    console.warn('No analysis ID available for feedback');
    return false;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysis_id: analysisId,
        section_id: sectionId,
        section_title: sectionTitle,
        feedback: feedback,
        feedback_reason: reason
      })
    });

    return response.ok;
  } catch (error) {
    console.warn('Could not submit feedback:', error.message);
    return false;
  }
}

// Parse analysis markdown into sections based on h2 headers
function parseAnalysisSections(markdown) {
  const sections = [];
  const lines = markdown.split('\n');

  let currentSection = null;
  let currentContent = [];
  let sectionCounter = 0;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Save previous section
      if (currentSection) {
        currentSection.content = currentContent.join('\n').trim();
        sections.push(currentSection);
      }

      sectionCounter++;
      const title = line.substring(3).trim();
      currentSection = {
        id: `section_${sectionCounter}`,
        title: title,
        content: ''
      };
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    } else {
      // Content before first h2 - treat as intro
      if (line.trim()) {
        if (!sections.find(s => s.id === 'intro')) {
          currentSection = {
            id: 'intro',
            title: 'Introduction',
            content: ''
          };
          currentContent = [line];
        }
      }
    }
  }

  // Don't forget the last section
  if (currentSection) {
    currentSection.content = currentContent.join('\n').trim();
    sections.push(currentSection);
  }

  return sections;
}

// Render analysis with per-section feedback buttons
function renderAnalysisWithFeedback(sections) {
  // Reset feedback state for new analysis
  sectionFeedbackState = {};

  let html = '';

  sections.forEach(section => {
    const contentHtml = marked.parse(section.content);

    if (section.id === 'intro') {
      // Intro section without feedback buttons
      html += `<div class="section-wrapper">${contentHtml}</div>`;
    } else {
      html += `
        <div class="section-wrapper" data-section-id="${section.id}">
          <div class="section-header">
            <h2>${section.title}</h2>
            <button class="section-feedback-trigger" data-section-id="${section.id}" data-section-title="${section.title}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              Feedback
            </button>
          </div>
          <div class="section-content">${contentHtml}</div>
        </div>
      `;
    }
  });

  analysisContent.innerHTML = html;

  // Add click handlers for section feedback trigger buttons
  document.querySelectorAll('.section-feedback-trigger').forEach(btn => {
    btn.addEventListener('click', openFeedbackModal);
  });
}

// Open overall feedback modal
function openOverallFeedbackModal() {
  // Check if already submitted
  if (overallFeedbackSubmitted) {
    return;
  }

  // Set modal to overall mode
  currentModalSection = { id: 'overall', title: 'Overall Analysis', isOverall: true };

  // Reset modal state
  document.getElementById('modalTitle').textContent = 'Overall Analysis Feedback';
  document.getElementById('modalSectionName').textContent = 'Rate the entire analysis';
  document.getElementById('modalThumbsUp').classList.remove('selected');
  document.getElementById('modalThumbsDown').classList.remove('selected');
  document.getElementById('feedbackReasonContainer').style.display = 'none';
  document.getElementById('feedbackReason').value = '';
  document.getElementById('modalSubmit').disabled = true;
  document.getElementById('modalSubmit').textContent = 'Submit Feedback';

  // Show modal
  document.getElementById('feedbackModal').classList.add('active');
}

// Modal functions
function setupModalListeners() {
  const modal = document.getElementById('feedbackModal');
  const closeBtn = document.getElementById('modalClose');
  const cancelBtn = document.getElementById('modalCancel');
  const submitBtn = document.getElementById('modalSubmit');
  const thumbsUp = document.getElementById('modalThumbsUp');
  const thumbsDown = document.getElementById('modalThumbsDown');
  const reasonContainer = document.getElementById('feedbackReasonContainer');
  const reasonTextarea = document.getElementById('feedbackReason');

  // Close modal
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Thumbs up - no explanation needed
  thumbsUp.addEventListener('click', () => {
    thumbsUp.classList.add('selected');
    thumbsDown.classList.remove('selected');
    reasonContainer.style.display = 'none';
    submitBtn.disabled = false;
  });

  // Thumbs down - show explanation field
  thumbsDown.addEventListener('click', () => {
    thumbsDown.classList.add('selected');
    thumbsUp.classList.remove('selected');
    reasonContainer.style.display = 'block';
    // Require explanation for negative feedback
    updateSubmitState();
  });

  // Update submit button state based on textarea
  reasonTextarea.addEventListener('input', updateSubmitState);

  // Submit feedback
  submitBtn.addEventListener('click', submitModalFeedback);
}

function updateSubmitState() {
  const thumbsDown = document.getElementById('modalThumbsDown');
  const reasonTextarea = document.getElementById('feedbackReason');
  const submitBtn = document.getElementById('modalSubmit');

  if (thumbsDown.classList.contains('selected')) {
    // Negative feedback requires explanation
    submitBtn.disabled = reasonTextarea.value.trim().length < 10;
  } else {
    submitBtn.disabled = false;
  }
}

function openFeedbackModal(event) {
  const btn = event.currentTarget;
  const sectionId = btn.dataset.sectionId;
  const sectionTitle = btn.dataset.sectionTitle;

  // Check if already submitted
  if (sectionFeedbackState[sectionId]) {
    return;
  }

  currentModalSection = { id: sectionId, title: sectionTitle, isOverall: false };

  // Reset modal state
  document.getElementById('modalTitle').textContent = 'Section Feedback';
  document.getElementById('modalSectionName').textContent = sectionTitle;
  document.getElementById('modalThumbsUp').classList.remove('selected');
  document.getElementById('modalThumbsDown').classList.remove('selected');
  document.getElementById('feedbackReasonContainer').style.display = 'none';
  document.getElementById('feedbackReason').value = '';
  document.getElementById('modalSubmit').disabled = true;
  document.getElementById('modalSubmit').textContent = 'Submit Feedback';

  // Show modal
  document.getElementById('feedbackModal').classList.add('active');
}

function closeModal() {
  document.getElementById('feedbackModal').classList.remove('active');
  currentModalSection = null;
}

async function submitModalFeedback() {
  if (!currentModalSection) return;

  const submitBtn = document.getElementById('modalSubmit');

  // Prevent double submission
  if (submitBtn.disabled) return;

  const thumbsUp = document.getElementById('modalThumbsUp');
  const reasonTextarea = document.getElementById('feedbackReason');

  const feedback = thumbsUp.classList.contains('selected') ? 'up' : 'down';
  const reason = feedback === 'down' ? reasonTextarea.value.trim() : null;

  // Disable button and show submitting state
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  // Submit to backend
  const success = await submitFeedbackToBackend(
    currentResult?.analysisId,
    currentModalSection.id,
    currentModalSection.title,
    feedback,
    reason
  );

  // Handle overall vs section feedback
  if (currentModalSection.isOverall) {
    // Mark overall feedback as submitted
    overallFeedbackSubmitted = true;

    // Update the overall trigger button to show submitted state
    const overallTrigger = document.getElementById('overallFeedbackTrigger');
    overallTrigger.classList.add('submitted', feedback === 'up' ? 'positive' : 'negative');
    overallTrigger.innerHTML = feedback === 'up'
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg> Thanks!`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg> Noted`;
  } else {
    // Mark section as submitted
    sectionFeedbackState[currentModalSection.id] = { feedback, reason };

    // Update the section trigger button to show submitted state
    const triggerBtn = document.querySelector(
      `.section-feedback-trigger[data-section-id="${currentModalSection.id}"]`
    );
    if (triggerBtn) {
      triggerBtn.classList.add('submitted', feedback === 'up' ? 'positive' : 'negative');
      triggerBtn.innerHTML = feedback === 'up'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg> Thanks!`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg> Noted`;
    }
  }

  closeModal();

  // Refresh stats in background
  loadFeedbackStats();
}

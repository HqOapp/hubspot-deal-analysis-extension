/**
 * HubSpot API Client for Chrome Extension
 */

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

class HubSpotClient {
  constructor(token, dealId) {
    this.token = token;
    this.dealId = dealId;
  }

  async fetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`HubSpot API error: ${response.status}`);
    }

    return response.json();
  }

  async getDeal() {
    const props = "dealname,amount,dealstage,pipeline,closedate,createdate,hubspot_owner_id,description,hs_lastmodifieddate";
    const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/deals/${this.dealId}?properties=${props}`;
    return this.fetch(url);
  }

  async getAssociations(toObject) {
    const url = `${HUBSPOT_BASE_URL}/crm/v4/objects/deals/${this.dealId}/associations/${toObject}`;
    let allResults = [];
    let nextUrl = url;

    while (nextUrl) {
      const data = await this.fetch(nextUrl);
      allResults = allResults.concat(data.results || []);
      nextUrl = data.paging?.next?.link || null;
    }

    return allResults;
  }

  async getObjectBatch(objectType, objectIds, properties) {
    if (!objectIds || objectIds.length === 0) return [];

    const url = `${HUBSPOT_BASE_URL}/crm/v3/objects/${objectType}/batch/read`;
    const payload = {
      inputs: objectIds.map(id => ({ id: String(id) })),
      properties: properties
    };

    const data = await this.fetch(url, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return data.results || [];
  }

  async getContacts() {
    const assocs = await this.getAssociations("contacts");
    const ids = assocs.map(a => a.toObjectId).filter(Boolean);
    return this.getObjectBatch("contacts", ids, ["firstname", "lastname", "email", "phone", "company"]);
  }

  async getCompanies() {
    const assocs = await this.getAssociations("companies");
    const ids = assocs.map(a => a.toObjectId).filter(Boolean);
    return this.getObjectBatch("companies", ids, ["name", "domain", "industry"]);
  }

  async getAllEngagements() {
    const engagementConfig = {
      emails: [
        "hs_email_subject", "hs_email_text", "hs_email_html", "hs_timestamp",
        "hs_email_direction", "hs_email_from_email", "hs_email_to_email",
        "hs_email_from_firstname", "hs_email_from_lastname"
      ],
      notes: ["hs_note_body", "hs_timestamp", "hubspot_owner_id", "hs_body_preview"],
      calls: [
        "hs_call_body", "hs_call_title", "hs_timestamp", "hs_call_duration",
        "hs_call_direction", "hs_call_status", "hs_call_from_number", "hs_call_to_number",
        "hs_call_recording_url"
      ],
      meetings: [
        "hs_meeting_title", "hs_meeting_body", "hs_timestamp",
        "hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_outcome"
      ],
      tasks: [
        "hs_task_subject", "hs_task_body", "hs_timestamp",
        "hs_task_status", "hs_task_priority"
      ]
    };

    const allEngagements = [];

    for (const [engType, props] of Object.entries(engagementConfig)) {
      const associations = await this.getAssociations(engType);
      const objectIds = associations.map(a => a.toObjectId).filter(Boolean);

      if (objectIds.length > 0) {
        const details = await this.getObjectBatch(engType, objectIds, props);
        for (const d of details) {
          d._engagement_type = engType;
          allEngagements.push(d);
        }
      }
    }

    return allEngagements;
  }
}

// Utility functions
function stripHtml(htmlContent, preserveUrls = true) {
  if (!htmlContent) return "";

  let clean = htmlContent.replace(/<[^>]+>/g, ' ');
  clean = decodeHtmlEntities(clean);

  if (!preserveUrls) {
    clean = clean.replace(/<https?:\/\/[^>]+>/g, '');
    clean = clean.replace(/https?:\/\/\S+/g, '');
  } else {
    clean = clean.replace(/<(https?:\/\/[^>]+)>/g, '$1');
  }

  // Remove email addresses in signatures
  clean = clean.replace(/^\s*[\w.-]+@[\w.-]+\.\w+\s*$/gm, '');
  // Remove phone numbers
  clean = clean.replace(/^\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\s*$/gm, '');
  // Remove quoted replies
  clean = clean.replace(/On\s+\w{3},\s+\w{3}\s+\d{1,2},\s+\d{4}\s+at\s+[\d:]+\s*[AP]M.*?wrote:.*/gs, '');
  clean = clean.replace(/^\s*>.*$/gm, '');
  // Remove email headers
  clean = clean.replace(/^\s*\*?(From|Sent|To|Cc|Subject|Date):\*?\s*.*$/gm, '');
  // Clean whitespace
  clean = clean.replace(/\n{3,}/g, '\n\n');
  clean = clean.replace(/[ \t]+/g, ' ');
  clean = clean.replace(/\n\s*\n/g, '\n\n');

  return clean.trim();
}

function decodeHtmlEntities(text) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function formatTimestamp(ts) {
  if (!ts) return "Unknown date";
  try {
    const dt = new Date(parseInt(ts));
    return dt.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(ts);
  }
}

function extractUrlsFromContent(content) {
  if (!content) return [];
  const urlPattern = /https?:\/\/[^\s<>"']+[^\s<>"'.,]/g;
  const urls = content.match(urlPattern) || [];
  return [...new Set(urls.map(url => url.replace(/[.,;:]+$/, '')))];
}

function collectAllUrls(engagements) {
  const allUrls = {};

  for (const eng of engagements) {
    const engType = eng._engagement_type || "unknown";
    const props = eng.properties || {};
    const timestamp = formatTimestamp(props.hs_timestamp);

    let content = "";
    let context = "";

    if (engType === "emails") {
      content = props.hs_email_text || props.hs_email_html || "";
      const subject = props.hs_email_subject || "(No subject)";
      context = `Email: ${subject} (${timestamp})`;
    } else if (engType === "notes") {
      content = props.hs_note_body || "";
      context = `Note (${timestamp})`;
    } else if (engType === "calls") {
      content = props.hs_call_body || "";
      const title = props.hs_call_title || "Call";
      context = `Call: ${title} (${timestamp})`;
    } else if (engType === "meetings") {
      content = props.hs_meeting_body || "";
      const title = props.hs_meeting_title || "Meeting";
      context = `Meeting: ${title} (${timestamp})`;
    } else if (engType === "tasks") {
      content = props.hs_task_body || "";
      const subject = props.hs_task_subject || "Task";
      context = `Task: ${subject} (${timestamp})`;
    }

    const urls = extractUrlsFromContent(content);
    for (const url of urls) {
      if (!allUrls[url]) allUrls[url] = [];
      allUrls[url].push(context);
    }
  }

  return allUrls;
}

function formatDealForClaude(deal, contacts, companies, engagements, collectedUrls) {
  const lines = [];
  const dealName = deal.properties?.dealname || "Unknown Deal";
  const props = deal.properties || {};

  lines.push(`# Deal: ${dealName}`);
  lines.push(`\n**Amount:** ${props.amount || 'N/A'}`);
  lines.push(`**Stage:** ${props.dealstage || 'N/A'}`);
  lines.push(`**Created:** ${props.createdate || 'N/A'}`);
  lines.push(`**Close Date:** ${props.closedate || 'N/A'}`);
  if (props.description) {
    lines.push(`**Description:** ${props.description}`);
  }
  lines.push("");

  if (contacts && contacts.length > 0) {
    lines.push("## Associated Contacts");
    for (const c of contacts) {
      const cp = c.properties || {};
      const name = `${cp.firstname || ''} ${cp.lastname || ''}`.trim() || "Unknown";
      const email = cp.email || 'N/A';
      const company = cp.company || '';
      lines.push(`- ${name} (${email})${company ? ` - ${company}` : ''}`);
    }
    lines.push("");
  }

  if (companies && companies.length > 0) {
    lines.push("## Associated Companies");
    for (const c of companies) {
      const cp = c.properties || {};
      const name = cp.name || 'Unknown';
      const domain = cp.domain || '';
      const industry = cp.industry || '';
      lines.push(`- **${name}**${domain ? ` (${domain})` : ''}${industry ? ` - ${industry}` : ''}`);
    }
    lines.push("");
  }

  // Sort engagements by timestamp
  const sortedEngagements = [...engagements].sort((a, b) => {
    const tsA = parseInt(a.properties?.hs_timestamp) || 0;
    const tsB = parseInt(b.properties?.hs_timestamp) || 0;
    return tsA - tsB;
  });

  lines.push("## Activity Timeline (Chronological)");
  lines.push(`*${sortedEngagements.length} total activities*\n`);

  for (const eng of sortedEngagements) {
    const engType = eng._engagement_type || "unknown";
    const props = eng.properties || {};
    const timestamp = formatTimestamp(props.hs_timestamp);

    if (engType === "emails") {
      const subject = props.hs_email_subject || "(No subject)";
      const direction = props.hs_email_direction || "";
      const fromEmail = props.hs_email_from_email || "";
      const toEmail = props.hs_email_to_email || "";
      const body = stripHtml(props.hs_email_text, true) || stripHtml(props.hs_email_html, true);
      const dirLabel = direction === "EMAIL" ? "OUTBOUND" : "INBOUND";

      lines.push(`### [${timestamp}] EMAIL (${dirLabel})`);
      lines.push(`**Subject:** ${subject}`);
      lines.push(`**From:** ${fromEmail} -> **To:** ${toEmail}`);
      lines.push(`\n${body}\n`);
      lines.push("---");
    } else if (engType === "notes") {
      const body = stripHtml(props.hs_note_body, true) || props.hs_body_preview || "";
      lines.push(`### [${timestamp}] NOTE`);
      lines.push(`\n${body}\n`);
      lines.push("---");
    } else if (engType === "calls") {
      const title = props.hs_call_title || "Call";
      const duration = props.hs_call_duration || "";
      const body = props.hs_call_body || "";
      const durationStr = duration ? ` (${Math.floor(parseFloat(duration) / 60)}m ${Math.floor(parseFloat(duration) % 60)}s)` : "";

      lines.push(`### [${timestamp}] CALL: ${title}${durationStr}`);
      if (body) lines.push(`\n${stripHtml(body, true)}\n`);
      lines.push("---");
    } else if (engType === "meetings") {
      const title = props.hs_meeting_title || "Meeting";
      const body = props.hs_meeting_body || "";
      const outcome = props.hs_meeting_outcome || "";

      lines.push(`### [${timestamp}] MEETING: ${title}`);
      if (outcome) lines.push(`**Outcome:** ${outcome}`);
      if (body) lines.push(`\n${stripHtml(body, true)}\n`);
      lines.push("---");
    } else if (engType === "tasks") {
      const subject = props.hs_task_subject || "Task";
      const status = props.hs_task_status || "";
      const body = props.hs_task_body || "";

      lines.push(`### [${timestamp}] TASK: ${subject} [${status}]`);
      if (body) lines.push(`\n${stripHtml(body, true)}\n`);
      lines.push("---");
    }
  }

  if (collectedUrls && Object.keys(collectedUrls).length > 0) {
    lines.push("\n## Linked Documents & URLs");
    lines.push(`*${Object.keys(collectedUrls).length} unique URLs found in deal activities*\n`);

    const docUrls = [];
    const hubspotUrls = [];
    const otherUrls = [];

    for (const [url, contexts] of Object.entries(collectedUrls)) {
      const urlLower = url.toLowerCase();
      if (['docs.google', 'drive.google', 'notion.so', 'dropbox', 'sharepoint', 'onedrive'].some(d => urlLower.includes(d))) {
        docUrls.push([url, contexts]);
      } else if (urlLower.includes('hubspot')) {
        hubspotUrls.push([url, contexts]);
      } else {
        otherUrls.push([url, contexts]);
      }
    }

    if (docUrls.length > 0) {
      lines.push("### Meeting Notes & Documents");
      for (const [url, contexts] of docUrls) {
        lines.push(`- ${url}`);
        lines.push(`  *Found in: ${contexts.slice(0, 3).join(', ')}${contexts.length > 3 ? '...' : ''}*`);
      }
    }

    if (hubspotUrls.length > 0) {
      lines.push("\n### HubSpot Links");
      for (const [url] of hubspotUrls) {
        lines.push(`- ${url}`);
      }
    }

    if (otherUrls.length > 0) {
      lines.push("\n### Other Links");
      for (const [url] of otherUrls.slice(0, 20)) {
        lines.push(`- ${url}`);
      }
      if (otherUrls.length > 20) {
        lines.push(`*... and ${otherUrls.length - 20} more*`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// Claude API function (uses hardcoded ANALYSIS_TYPES - legacy)
async function analyzeWithClaude(apiKey, dealContent, analysisType) {
  const config = ANALYSIS_TYPES[analysisType];
  if (!config) {
    throw new Error(`Unknown analysis type: ${analysisType}`);
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: config.systemPrompt,
      messages: [
        {
          role: "user",
          content: config.userPrompt.replace("{deal_content}", dealContent)
        }
      ]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// Claude API function with custom system prompt (from Snowflake)
async function analyzeWithClaudeCustomPrompt(apiKey, dealContent, systemPrompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Analyze the following HubSpot deal:\n\n${dealContent}`
        }
      ]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

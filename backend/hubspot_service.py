"""
HubSpot API Service for fetching deal data.

Environment variables required:
- HUBSPOT_ACCESS_TOKEN: HubSpot Private App access token
"""

import os
import re
import requests
from typing import Dict, Any, List, Optional
from html import unescape

HUBSPOT_BASE_URL = "https://api.hubapi.com"


def get_hubspot_token() -> str:
    """Get HubSpot access token from environment."""
    token = os.environ.get("HUBSPOT_ACCESS_TOKEN", "")
    if not token:
        raise ValueError("HUBSPOT_ACCESS_TOKEN environment variable not set")
    return token


def hubspot_request(url: str, method: str = "GET", data: Optional[Dict] = None) -> Dict:
    """Make authenticated request to HubSpot API."""
    token = get_hubspot_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    if method == "GET":
        response = requests.get(url, headers=headers)
    else:
        response = requests.post(url, headers=headers, json=data)

    if not response.ok:
        raise Exception(f"HubSpot API error: {response.status_code} - {response.text}")

    return response.json()


def get_deal(deal_id: str) -> Dict:
    """Fetch deal by ID."""
    props = "dealname,amount,dealstage,pipeline,closedate,createdate,hubspot_owner_id,description,hs_lastmodifieddate"
    url = f"{HUBSPOT_BASE_URL}/crm/v3/objects/deals/{deal_id}?properties={props}"
    return hubspot_request(url)


def get_associations(deal_id: str, to_object: str) -> List[Dict]:
    """Get all associations for a deal."""
    url = f"{HUBSPOT_BASE_URL}/crm/v4/objects/deals/{deal_id}/associations/{to_object}"
    all_results = []

    while url:
        data = hubspot_request(url)
        all_results.extend(data.get("results", []))
        url = data.get("paging", {}).get("next", {}).get("link")

    return all_results


def get_object_batch(object_type: str, object_ids: List[str], properties: List[str]) -> List[Dict]:
    """Batch read objects by IDs."""
    if not object_ids:
        return []

    url = f"{HUBSPOT_BASE_URL}/crm/v3/objects/{object_type}/batch/read"
    payload = {
        "inputs": [{"id": str(oid)} for oid in object_ids],
        "properties": properties
    }

    data = hubspot_request(url, method="POST", data=payload)
    return data.get("results", [])


def get_contacts(deal_id: str) -> List[Dict]:
    """Get contacts associated with a deal."""
    assocs = get_associations(deal_id, "contacts")
    ids = [a.get("toObjectId") for a in assocs if a.get("toObjectId")]
    return get_object_batch("contacts", ids, ["firstname", "lastname", "email", "phone", "company"])


def get_companies(deal_id: str) -> List[Dict]:
    """Get companies associated with a deal."""
    assocs = get_associations(deal_id, "companies")
    ids = [a.get("toObjectId") for a in assocs if a.get("toObjectId")]
    return get_object_batch("companies", ids, ["name", "domain", "industry"])


def get_all_engagements(deal_id: str) -> List[Dict]:
    """Get all engagements (emails, notes, calls, meetings, tasks) for a deal."""
    engagement_config = {
        "emails": [
            "hs_email_subject", "hs_email_text", "hs_email_html", "hs_timestamp",
            "hs_email_direction", "hs_email_from_email", "hs_email_to_email",
            "hs_email_from_firstname", "hs_email_from_lastname"
        ],
        "notes": ["hs_note_body", "hs_timestamp", "hubspot_owner_id", "hs_body_preview"],
        "calls": [
            "hs_call_body", "hs_call_title", "hs_timestamp", "hs_call_duration",
            "hs_call_direction", "hs_call_status", "hs_call_from_number", "hs_call_to_number",
            "hs_call_recording_url"
        ],
        "meetings": [
            "hs_meeting_title", "hs_meeting_body", "hs_timestamp",
            "hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_outcome"
        ],
        "tasks": [
            "hs_task_subject", "hs_task_body", "hs_timestamp",
            "hs_task_status", "hs_task_priority"
        ]
    }

    all_engagements = []

    for eng_type, props in engagement_config.items():
        assocs = get_associations(deal_id, eng_type)
        ids = [a.get("toObjectId") for a in assocs if a.get("toObjectId")]

        if ids:
            details = get_object_batch(eng_type, ids, props)
            for d in details:
                d["_engagement_type"] = eng_type
                all_engagements.append(d)

    return all_engagements


# Utility functions for formatting

def strip_html(html_content: str, preserve_urls: bool = True) -> str:
    """Strip HTML tags and clean up content."""
    if not html_content:
        return ""

    # Remove HTML tags
    clean = re.sub(r'<[^>]+>', ' ', html_content)
    clean = unescape(clean)

    if not preserve_urls:
        clean = re.sub(r'<https?://[^>]+>', '', clean)
        clean = re.sub(r'https?://\S+', '', clean)
    else:
        clean = re.sub(r'<(https?://[^>]+)>', r'\1', clean)

    # Remove email addresses in signatures
    clean = re.sub(r'^\s*[\w.-]+@[\w.-]+\.\w+\s*$', '', clean, flags=re.MULTILINE)
    # Remove phone numbers
    clean = re.sub(r'^\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\s*$', '', clean, flags=re.MULTILINE)
    # Remove quoted replies
    clean = re.sub(r'On\s+\w{3},\s+\w{3}\s+\d{1,2},\s+\d{4}\s+at\s+[\d:]+\s*[AP]M.*?wrote:.*', '', clean, flags=re.DOTALL)
    clean = re.sub(r'^\s*>.*$', '', clean, flags=re.MULTILINE)
    # Remove email headers
    clean = re.sub(r'^\s*\*?(From|Sent|To|Cc|Subject|Date):\*?\s*.*$', '', clean, flags=re.MULTILINE)
    # Clean whitespace
    clean = re.sub(r'\n{3,}', '\n\n', clean)
    clean = re.sub(r'[ \t]+', ' ', clean)
    clean = re.sub(r'\n\s*\n', '\n\n', clean)

    return clean.strip()


def format_timestamp(ts: Optional[str]) -> str:
    """Format a timestamp. Handles both milliseconds and ISO format."""
    if not ts:
        return "Unknown date"
    try:
        from datetime import datetime
        # Try milliseconds first (older HubSpot format)
        if ts.isdigit():
            dt = datetime.fromtimestamp(int(ts) / 1000)
        # Try ISO format (e.g., "2026-01-12T15:14:37.106Z")
        elif 'T' in ts:
            ts_clean = ts.replace('Z', '+00:00')
            dt = datetime.fromisoformat(ts_clean.replace('+00:00', ''))
        else:
            return str(ts)
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(ts)


def extract_urls_from_content(content: str) -> List[str]:
    """Extract URLs from content."""
    if not content:
        return []
    url_pattern = r'https?://[^\s<>"\']+[^\s<>"\'.,]'
    urls = re.findall(url_pattern, content)
    return list(set(url.rstrip('.,;:') for url in urls))


def collect_all_urls(engagements: List[Dict]) -> Dict[str, List[str]]:
    """Collect all URLs from engagements with context."""
    all_urls = {}

    for eng in engagements:
        eng_type = eng.get("_engagement_type", "unknown")
        props = eng.get("properties", {})
        timestamp = format_timestamp(props.get("hs_timestamp"))

        content = ""
        context = ""

        if eng_type == "emails":
            content = props.get("hs_email_text") or props.get("hs_email_html") or ""
            subject = props.get("hs_email_subject") or "(No subject)"
            context = f"Email: {subject} ({timestamp})"
        elif eng_type == "notes":
            content = props.get("hs_note_body") or ""
            context = f"Note ({timestamp})"
        elif eng_type == "calls":
            content = props.get("hs_call_body") or ""
            title = props.get("hs_call_title") or "Call"
            context = f"Call: {title} ({timestamp})"
        elif eng_type == "meetings":
            content = props.get("hs_meeting_body") or ""
            title = props.get("hs_meeting_title") or "Meeting"
            context = f"Meeting: {title} ({timestamp})"
        elif eng_type == "tasks":
            content = props.get("hs_task_body") or ""
            subject = props.get("hs_task_subject") or "Task"
            context = f"Task: {subject} ({timestamp})"

        urls = extract_urls_from_content(content)
        for url in urls:
            if url not in all_urls:
                all_urls[url] = []
            all_urls[url].append(context)

    return all_urls


def format_deal_for_analysis(deal: Dict, contacts: List[Dict], companies: List[Dict],
                              engagements: List[Dict], collected_urls: Dict) -> str:
    """Format deal data for Claude analysis."""
    lines = []
    deal_name = deal.get("properties", {}).get("dealname") or "Unknown Deal"
    props = deal.get("properties", {})

    lines.append(f"# Deal: {deal_name}")
    lines.append(f"\n**Amount:** {props.get('amount') or 'N/A'}")
    lines.append(f"**Stage:** {props.get('dealstage') or 'N/A'}")
    lines.append(f"**Created:** {props.get('createdate') or 'N/A'}")
    lines.append(f"**Close Date:** {props.get('closedate') or 'N/A'}")
    if props.get("description"):
        lines.append(f"**Description:** {props['description']}")
    lines.append("")

    if contacts:
        lines.append("## Associated Contacts")
        for c in contacts:
            cp = c.get("properties", {})
            name = f"{cp.get('firstname') or ''} {cp.get('lastname') or ''}".strip() or "Unknown"
            email = cp.get("email") or "N/A"
            company = cp.get("company") or ""
            lines.append(f"- {name} ({email}){f' - {company}' if company else ''}")
        lines.append("")

    if companies:
        lines.append("## Associated Companies")
        for c in companies:
            cp = c.get("properties", {})
            name = cp.get("name") or "Unknown"
            domain = cp.get("domain") or ""
            industry = cp.get("industry") or ""
            lines.append(f"- **{name}**{f' ({domain})' if domain else ''}{f' - {industry}' if industry else ''}")
        lines.append("")

    # Sort engagements by timestamp
    def parse_timestamp_for_sort(ts):
        """Parse timestamp for sorting. Returns 0 if unparseable."""
        if not ts:
            return 0
        try:
            if str(ts).isdigit():
                return int(ts)
            elif 'T' in str(ts):
                from datetime import datetime
                ts_clean = str(ts).replace('Z', '').split('.')[0]
                dt = datetime.fromisoformat(ts_clean)
                return int(dt.timestamp() * 1000)
        except Exception:
            pass
        return 0

    sorted_engagements = sorted(
        engagements,
        key=lambda e: parse_timestamp_for_sort(e.get("properties", {}).get("hs_timestamp"))
    )

    lines.append("## Activity Timeline (Chronological)")
    lines.append(f"*{len(sorted_engagements)} total activities*\n")

    for eng in sorted_engagements:
        eng_type = eng.get("_engagement_type", "unknown")
        props = eng.get("properties", {})
        timestamp = format_timestamp(props.get("hs_timestamp"))

        if eng_type == "emails":
            subject = props.get("hs_email_subject") or "(No subject)"
            direction = props.get("hs_email_direction") or ""
            from_email = props.get("hs_email_from_email") or ""
            to_email = props.get("hs_email_to_email") or ""
            body = strip_html(props.get("hs_email_text"), True) or strip_html(props.get("hs_email_html"), True)
            dir_label = "OUTBOUND" if direction == "EMAIL" else "INBOUND"

            lines.append(f"### [{timestamp}] EMAIL ({dir_label})")
            lines.append(f"**Subject:** {subject}")
            lines.append(f"**From:** {from_email} -> **To:** {to_email}")
            lines.append(f"\n{body}\n")
            lines.append("---")
        elif eng_type == "notes":
            body = strip_html(props.get("hs_note_body"), True) or props.get("hs_body_preview") or ""
            lines.append(f"### [{timestamp}] NOTE")
            lines.append(f"\n{body}\n")
            lines.append("---")
        elif eng_type == "calls":
            title = props.get("hs_call_title") or "Call"
            duration = props.get("hs_call_duration") or ""
            body = props.get("hs_call_body") or ""
            duration_str = ""
            if duration:
                try:
                    dur = float(duration)
                    duration_str = f" ({int(dur // 60)}m {int(dur % 60)}s)"
                except Exception:
                    pass

            lines.append(f"### [{timestamp}] CALL: {title}{duration_str}")
            if body:
                lines.append(f"\n{strip_html(body, True)}\n")
            lines.append("---")
        elif eng_type == "meetings":
            title = props.get("hs_meeting_title") or "Meeting"
            body = props.get("hs_meeting_body") or ""
            outcome = props.get("hs_meeting_outcome") or ""

            lines.append(f"### [{timestamp}] MEETING: {title}")
            if outcome:
                lines.append(f"**Outcome:** {outcome}")
            if body:
                lines.append(f"\n{strip_html(body, True)}\n")
            lines.append("---")
        elif eng_type == "tasks":
            subject = props.get("hs_task_subject") or "Task"
            status = props.get("hs_task_status") or ""
            body = props.get("hs_task_body") or ""

            lines.append(f"### [{timestamp}] TASK: {subject} [{status}]")
            if body:
                lines.append(f"\n{strip_html(body, True)}\n")
            lines.append("---")

    if collected_urls:
        lines.append("\n## Linked Documents & URLs")
        lines.append(f"*{len(collected_urls)} unique URLs found in deal activities*\n")

        doc_urls = []
        hubspot_urls = []
        other_urls = []

        for url, contexts in collected_urls.items():
            url_lower = url.lower()
            if any(d in url_lower for d in ['docs.google', 'drive.google', 'notion.so', 'dropbox', 'sharepoint', 'onedrive']):
                doc_urls.append((url, contexts))
            elif 'hubspot' in url_lower:
                hubspot_urls.append((url, contexts))
            else:
                other_urls.append((url, contexts))

        if doc_urls:
            lines.append("### Meeting Notes & Documents")
            for url, contexts in doc_urls:
                lines.append(f"- {url}")
                ctx_str = ', '.join(contexts[:3])
                if len(contexts) > 3:
                    ctx_str += '...'
                lines.append(f"  *Found in: {ctx_str}*")

        if hubspot_urls:
            lines.append("\n### HubSpot Links")
            for url, _ in hubspot_urls:
                lines.append(f"- {url}")

        if other_urls:
            lines.append("\n### Other Links")
            for url, _ in other_urls[:20]:
                lines.append(f"- {url}")
            if len(other_urls) > 20:
                lines.append(f"*... and {len(other_urls) - 20} more*")

        lines.append("")

    return "\n".join(lines)


def fetch_deal_data(deal_id: str) -> Dict[str, Any]:
    """Fetch all deal data and return formatted for analysis."""
    deal = get_deal(deal_id)
    contacts = get_contacts(deal_id)
    companies = get_companies(deal_id)
    engagements = get_all_engagements(deal_id)
    collected_urls = collect_all_urls(engagements)

    formatted_content = format_deal_for_analysis(deal, contacts, companies, engagements, collected_urls)

    return {
        "deal": deal,
        "deal_name": deal.get("properties", {}).get("dealname") or "Unknown Deal",
        "contacts": contacts,
        "companies": companies,
        "engagements": engagements,
        "formatted_content": formatted_content
    }

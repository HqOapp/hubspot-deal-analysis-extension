"""
Claude API Service for running AI analysis.

Environment variables required:
- CLAUDE_API_KEY: Anthropic API key
"""

import os
import requests
from typing import Dict, Any


def get_claude_api_key() -> str:
    """Get Claude API key from environment."""
    key = os.environ.get("CLAUDE_API_KEY", "")
    if not key:
        raise ValueError("CLAUDE_API_KEY environment variable not set")
    return key


def analyze_with_claude(deal_content: str, system_prompt: str) -> str:
    """
    Run Claude analysis on deal content.

    Args:
        deal_content: Formatted deal data
        system_prompt: System prompt for the analysis type

    Returns:
        Analysis text from Claude
    """
    api_key = get_claude_api_key()

    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01"
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": f"Analyze the following HubSpot deal:\n\n{deal_content}"
                }
            ]
        }
    )

    if not response.ok:
        error_data = response.json() if response.text else {}
        error_msg = error_data.get("error", {}).get("message", f"Claude API error: {response.status_code}")
        raise Exception(error_msg)

    data = response.json()
    return data["content"][0]["text"]

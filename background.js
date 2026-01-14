/**
 * Background service worker for HubSpot Deal Analyzer
 * Opens the side panel when the extension icon is clicked
 */

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

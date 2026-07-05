// Settings are stored in localStorage on-device — nothing about the
// user's conversations is ever stored here, only their style preference.

const STYLES = ["friendly", "confident", "funny", "sincere", "flirty-lite"];
const STORAGE_KEY = "reply_assistant_settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { style: "friendly", numSuggestions: 3 };
  } catch {
    return { style: "friendly", numSuggestions: 3 };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const settings = loadSettings();

const styleChips = document.getElementById("styleChips");
const numSuggestionsInput = document.getElementById("numSuggestions");
const convoInput = document.getElementById("convoInput");
const suggestBtn = document.getElementById("suggestBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

function renderChips() {
  styleChips.innerHTML = "";
  STYLES.forEach((style) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (settings.style === style ? " selected" : "");
    chip.textContent = style;
    chip.onclick = () => {
      settings.style = style;
      saveSettings(settings);
      renderChips();
    };
    styleChips.appendChild(chip);
  });
}

numSuggestionsInput.value = settings.numSuggestions;
numSuggestionsInput.addEventListener("change", () => {
  settings.numSuggestions = Math.min(Math.max(parseInt(numSuggestionsInput.value, 10) || 3, 1), 5);
  saveSettings(settings);
});

renderChips();

function parseConversation(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ sender: "them", text: line }));
}

suggestBtn.addEventListener("click", async () => {
  const messages = parseConversation(convoInput.value);
  if (messages.length === 0) {
    statusEl.textContent = "Paste at least one message first.";
    return;
  }

  suggestBtn.disabled = true;
  statusEl.textContent = "Thinking of replies…";
  resultsEl.innerHTML = "";

  try {
    const res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        last_n_messages: messages,
        reply_style: settings.style,
        num_suggestions: settings.numSuggestions,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }

    const data = await res.json();
    statusEl.textContent = "";
    data.suggestions.forEach((suggestion) => {
      const div = document.createElement("div");
      div.className = "suggestion";
      div.textContent = suggestion;

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy";
      copyBtn.onclick = () => navigator.clipboard.writeText(suggestion);
      div.appendChild(document.createElement("br"));
      div.appendChild(copyBtn);

      resultsEl.appendChild(div);
    });
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
  } finally {
    suggestBtn.disabled = false;
  }
});

// Register service worker for installability / offline app shell
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
      }

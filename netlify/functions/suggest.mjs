// netlify/functions/suggest.mjs
//
// Reply-suggestion endpoint. Takes recent conversation context + a
// reply style, calls the Google Gemini API (free tier, no credit card
// required), and returns a few short suggestions for the user to
// review before sending.
//
// No-store policy: the request body is only held in memory for the
// duration of this invocation. Nothing is written to a database,
// Netlify Blobs, or logs.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || "gemini-2.5-flash";

function buildPrompt(messages, replyStyle, numSuggestions) {
  const convoText = messages
    .map((m) => `${m.sender === "me" ? "You" : "Them"}: ${m.text}`)
    .join("\n");

  return `You are helping someone reply in their own personal chat conversation.
Below is the recent conversation. Suggest ${numSuggestions} short, natural reply
options IN THE VOICE OF "You" (the user), written in a ${replyStyle} tone.

Rules:
- Suggestions must be things the user could plausibly say themselves.
- Do not suggest anything deceptive, manipulative, or pressuring.
- Do not fabricate facts about the user (no fake jobs, fake shared history, etc.).
- Keep each suggestion under 30 words.
- Return ONLY a numbered list of the suggestions, nothing else.

Conversation:
${convoText}`;
}

function parseSuggestions(rawText, numSuggestions) {
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[0-9]+[.)-]?\s*/, "").replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .slice(0, numSuggestions);
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Server missing GEMINI_API_KEY" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages = body.last_n_messages;
  const replyStyle = body.reply_style || "friendly";
  const numSuggestions = Math.min(Math.max(body.num_suggestions || 3, 1), 5);

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "last_n_messages cannot be empty" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const prompt = buildPrompt(messages, replyStyle, numSuggestions);

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300 },
      }),
    });

    if (!geminiResponse.ok) {
      console.error("Gemini API error (status only logged):", geminiResponse.status);
      return new Response(
        JSON.stringify({ error: "Upstream model call failed" }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    const data = await geminiResponse.json();
    const rawText =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";

    const suggestions = parseSuggestions(rawText, numSuggestions);

    if (suggestions.length === 0) {
      return new Response(
        JSON.stringify({ error: "No suggestions could be parsed" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // No-store policy: `body`, `messages`, and `prompt` are never persisted;
    // they fall out of scope when this invocation ends.
    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error (message omitted from logs)");
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/suggest",
};

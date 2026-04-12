exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { imageData, mimeType } = JSON.parse(event.body);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing API key" }) };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageData,
                }
              },
              {
                text: "You are a domino pip counter. Count the total number of pips (dots) on ALL domino tiles visible in this photo. Respond with ONLY a number. No words, no explanation, no punctuation — just the number."
              }
            ]
          }],
          generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingBudget: 0 } }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data.error) || "Unknown Gemini API error";
      console.error("Gemini API error:", response.status, errMsg);
      return { statusCode: 502, body: JSON.stringify({ error: "Gemini API error: " + errMsg }) };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    // Extract the first number from the response, even if model added words
    const match = text.match(/\d+/);
    const count = match ? parseInt(match[0]) : NaN;

    if (isNaN(count)) {
      return { statusCode: 422, body: JSON.stringify({ error: "Could not parse count", raw: text }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

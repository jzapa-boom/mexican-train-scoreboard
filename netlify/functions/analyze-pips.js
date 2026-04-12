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
                text: "This photo shows domino tiles. Count the pips (dots) on every tile. For each tile, count the left half and right half separately, then add them. Finally give the grand total of all pips across all tiles. End your response with the grand total on its own line like: TOTAL: 82"
              }
            ]
          }],
          generationConfig: { maxOutputTokens: 1024 }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data.error) || "Unknown Gemini API error";
      console.error("Gemini API error:", response.status, errMsg);
      return { statusCode: 502, body: JSON.stringify({ error: "Gemini API error: " + errMsg }) };
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    // With thinking enabled, find the text part (skip thinking parts)
    const textPart = parts.filter(p => p.text && !p.thought).pop();
    const text = textPart?.text?.trim() ?? "";
    // Look for TOTAL: N pattern first, fall back to last number in response
    const totalMatch = text.match(/TOTAL[:\s]+(\d+)/i);
    const count = totalMatch ? parseInt(totalMatch[1]) : NaN;
    if (isNaN(count)) {
      // Fallback: grab the last number in the response (likely the sum)
      const allNums = text.match(/\d+/g);
      const fallback = allNums ? parseInt(allNums[allNums.length - 1]) : NaN;
      if (isNaN(fallback)) {
        return { statusCode: 422, body: JSON.stringify({ error: "Could not parse count", raw: text }) };
      }
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: fallback }) };
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

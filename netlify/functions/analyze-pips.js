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
                text: "Count the pips (dots) on each domino tile in this photo. Each domino has two halves — count each half separately. List every tile as: left pips + right pips = tile total. After listing all tiles, write TOTAL: followed by the grand total. Be very careful with tiles that have 9, 10, 11, or 12 pips on one half — count row by row."
              }
            ]
          }],
          generationConfig: { maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } }
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

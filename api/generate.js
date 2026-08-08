async function webSearch(query) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        max_results: 5,
        include_answer: false
      })
    });
    const data = await response.json();
    if (!data.results || data.results.length === 0) return "";
    return data.results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
      .join("\n\n");
  } catch (err) {
    console.error("Web search failed:", err);
    return "";
  }
}

export default async function handler(req, res) {
  const { notes, question, images, history, extractOnly } = req.body;

  const hasImages = images && images.length > 0;
  const isChat = question && question.length > 0;

  let searchContext = "";
  if (isChat && !hasImages) {
    searchContext = await webSearch(question);
  }

  let promptText;
  if (extractOnly) {
    promptText = `Transcribe all readable text from these image(s) as accurately as possible. Return ONLY valid JSON (no markdown, no backticks) in this exact shape: {"extractedText":"..."}`;
  } else if (isChat) {
    let historyText = "";
    if (history && history.length > 0) {
      historyText = "Previous conversation:\n" + history.map(h => `Q: ${h.q}\nA: ${h.a}`).join("\n") + "\n\n";
    }
    let searchBlock = "";
    if (searchContext) {
      searchBlock = `\n\nCurrent web search results (use these for anything current, recent, or beyond your training knowledge — cite sources by number like [1] when you use them):\n${searchContext}\n`;
    }
    promptText = `You are a study and coding assistant answering questions about the provided source material, or helping with code, or answering general questions. ${historyText}Now respond to this: "${question}"
${searchBlock}
Rules:
- If the source material answers this, prioritize it.
- If this is about current events, recent info, or anything you're not certain about from training alone, use the web search results provided above.
- If this involves writing, fixing, or modifying code in ANY programming language, put the COMPLETE, properly indented code inside a fenced block like: \`\`\`language\ncode here\n\`\`\`. Always give the full working code, not just a snippet, even when asked to change something.
- Reply in clear formatted text (markdown is fine — headings, bold, tables, lists), no JSON.`;
  } else if (hasImages) {
    promptText = `You are a study assistant. Look at these image(s) and do two things:
1. Transcribe all readable text into a field called "extractedText".
2. Create a thorough study guide and flashcards from that content.
Return ONLY valid JSON in this EXACT shape, every flashcard a plain {"q":"...","a":"..."} object:
{"extractedText":"...", "guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."},{"q":"...","a":"..."}]}
Make the guide 5-7 sections with 3-5 points each. Make 8-12 flashcards.`;
  } else {
    promptText = `You are a study and coding assistant. The user's request may be to write/explain code in any programming language, OR to study notes/a topic. Decide which it is.

Return ONLY valid JSON in this EXACT shape:
{"code": {"language":"...", "content":"..."} or null, "guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."},{"q":"...","a":"..."}]}

Rules:
- If the request is about writing/explaining code: put the COMPLETE, properly indented, working code in "code.content", set "code.language" to the language name. Still include a short "guide" (2-4 sections) explaining how the code works, and flashcards testing understanding of it.
- If the request is NOT about code: set "code" to null, and build a normal thorough study guide (5-7 sections, 3-5 points each) and 8-12 flashcards from the material.
- Never put code inside "guide" points — code always goes in the "code" field only.`;
  }

  const useImages = hasImages && !isChat;
  const maxTokens = extractOnly ? 1500 : (useImages ? 2200 : (isChat ? 2200 : 6000));

  let body;
  if (useImages) {
    const content = [{ type: "text", text: promptText }];
    images.forEach(img => content.push({ type: "image_url", image_url: { url: img } }));
    body = {
      model: "qwen/qwen3.6-27b",
      messages: [{ role: "user", content }],
      temperature: 0.2,
      max_tokens: maxTokens,
      reasoning_effort: "none",
      response_format: { type: "json_object" }
    };
  } else {
    body = {
      model: "openai/gpt-oss-120b",
      messages: [{
        role: "user",
        content: isChat
          ? `${promptText}\n\nSource material (if relevant):\n"""${notes || "none provided"}"""`
          : `${promptText}\n\nSource material:\n"""${notes}"""`
      }],
      temperature: 0.3,
      max_tokens: maxTokens,
      reasoning_effort: "low",
      ...(isChat ? {} : { response_format: { type: "json_object" } })
    };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok || !data.choices) {
    console.error("Groq error:", JSON.stringify(data));
    let friendly = "Something went wrong. Please try again.";
    if (data.error?.code === "rate_limit_exceeded") {
      friendly = "You're asking questions a bit fast — please wait about 30 seconds and try again.";
    }
    return res.status(200).json({ content: [{ text: "" }], debug: data, friendlyError: friendly });
  }

  let text = data.choices?.[0]?.message?.content || "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  res.status(200).json({ content: [{ text }], debug: null, friendlyError: null });
}

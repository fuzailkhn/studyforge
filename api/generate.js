export default async function handler(req, res) {
  const { notes, question, images, history } = req.body;

  const hasImages = images && images.length > 0;
  const isChat = question && question.length > 0;

  let promptText;
  if (isChat) {
    let historyText = "";
    if (history && history.length > 0) {
      historyText = "Previous conversation:\n" + history.map(h => `Q: ${h.q}\nA: ${h.a}`).join("\n") + "\n\n";
    }
    promptText = `You are a study assistant answering questions about the provided source material. ${historyText}Now answer this question clearly and directly, using only the source material as your basis: "${question}"
Reply in plain conversational text, no JSON, no markdown formatting, just a clear direct answer.`;
  } else {
    promptText = `You are a study assistant. Create a thorough study guide and flashcards from this source material.
Return ONLY valid JSON (no markdown, no backticks) in this exact shape:
{"guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."}]}
Make the guide 5-7 sections with 3-5 points each. Make 8-12 flashcards.`;
  }

  const maxTokens = hasImages ? 1500 : (isChat ? 800 : 5500);

  let body;
  if (hasImages) {
    const content = [{ type: "text", text: promptText }];
    images.forEach(img => content.push({ type: "image_url", image_url: { url: img } }));
    body = {
      model: "qwen/qwen3.6-27b",
      messages: [{ role: "user", content }],
      temperature: 0.5,
      max_tokens: maxTokens,
      reasoning_effort: "none",
      ...(isChat ? {} : { response_format: { type: "json_object" } })
    };
  } else {
    body = {
      model: "openai/gpt-oss-120b",
      messages: [{
        role: "user",
        content: `${promptText}\n\nSource material:\n"""${notes}"""`
      }],
      temperature: 0.5,
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
    return res.status(200).json({ content: [{ text: "" }], debug: data });
  }

  let text = data.choices?.[0]?.message?.content || "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  res.status(200).json({ content: [{ text }], debug: null });
}

export default async function handler(req, res) {
  const { notes, instruction, images } = req.body;

  const basePrompt = instruction && instruction.length > 0
    ? `The user's specific request is: "${instruction}". Treat this as the primary instruction — if it's a question, answer it thoroughly and accurately using the source material. If it's a formatting request (like length or focus area), follow it exactly. If it's a mix, do both. Keep all content strictly relevant to what they asked; do not pad with unrelated information they didn't request.`
    : `No specific instruction was given, so create a thorough, detailed study guide: 5-7 sections, each with 3-5 clear points. Make 8-12 flashcards.`;

  const jsonInstruction = `Return ONLY valid JSON (no markdown, no backticks) in this exact shape:
{"guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."}]}
The "guide" and "flashcards" fields are always required, but adapt their content to directly serve the user's request above. If they asked a specific question, the guide's first section should directly answer it, and flashcards should reinforce that answer. ${basePrompt}`;

  const hasImages = images && images.length > 0;
  const maxTokens = hasImages ? 2000 : 5500;

  let body;
  if (hasImages) {
    const content = [
      { type: "text", text: `You are a study assistant. Look at these image(s) of notes/document pages. ${jsonInstruction}` }
    ];
    images.forEach(img => {
      content.push({ type: "image_url", image_url: { url: img } });
    });
    body = {
      model: "qwen/qwen3.6-27b",
      messages: [{ role: "user", content }],
      temperature: 0.5,
      max_tokens: maxTokens,
      reasoning_effort: "none",
      response_format: { type: "json_object" }
    };
  } else {
    body = {
      model: "openai/gpt-oss-120b",
      messages: [{
        role: "user",
        content: `You are a study assistant. Given this source material, respond according to the instructions. ${jsonInstruction}
Source material:
"""${notes}"""`
      }],
      temperature: 0.5,
      max_tokens: maxTokens,
      reasoning_effort: "low",
      response_format: { type: "json_object" }
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
  res.status(200).json({ content: [{ text }], debug: null, finishReason: data.choices[0].finish_reason });
}

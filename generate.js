export default async function handler(req, res) {
  const { notes } = req.body;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{
        role: "user",
        content: `You are a study assistant. Given these notes, return ONLY valid JSON (no markdown, no backticks) in this exact shape:
{"guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."}]}
Make the guide 3-6 sections. Make 6-10 flashcards. Notes:
"""${notes}"""`
      }],
      temperature: 0.5,
      max_tokens: 1500
    })
  });

  const data = await response.json();
  const text = data.choices[0].message.content;
  res.status(200).json({ content: [{ text }] });
}
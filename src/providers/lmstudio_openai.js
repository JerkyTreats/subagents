export class LmStudioOpenAIProvider {
  constructor({ baseUrl, model, apiKey = null, fetchImpl = fetch } = {}) {
    if (!baseUrl) throw new Error("LmStudioOpenAIProvider requires baseUrl");
    if (!model) throw new Error("LmStudioOpenAIProvider requires model");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async chatCompletion({ messages, temperature = 0.2, maxTokens = 512, signal } = {}) {
    const url = `${this.baseUrl}/chat/completions`;
    const headers = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Provider HTTP ${res.status}: ${text || res.statusText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Provider response missing message content");
    return content;
  }
}


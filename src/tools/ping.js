export const pingTool = {
  name: "ping",
  description: "Health check; returns 'pong'.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler() {
    return { content: [{ type: "text", text: "pong" }] };
  },
};

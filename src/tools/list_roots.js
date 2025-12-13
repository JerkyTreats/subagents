export const listRootsTool = {
  name: "list_roots",
  description: "List configured workspace roots (allowlist) for safe reads.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async handler({ config }) {
    const payload = { roots: config.roots };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
};


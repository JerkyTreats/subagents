export async function* readJsonLines(stream) {
  stream.setEncoding("utf8");

  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield trimmed;
    }
  }

  const remaining = buffer.trim();
  if (remaining) yield remaining;
}

export function writeJsonLine(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`);
}


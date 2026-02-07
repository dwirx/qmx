export type EmbedIntroInput = {
  documents: number;
  chunks: number;
  bytes: number;
  splitDocuments: number;
  model: string;
};

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function chunkByTokenCount(text: string, maxTokens = 220, overlapTokens = 40): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [""];
  if (tokens.length <= maxTokens) return [tokens.join(" ")];

  const chunks: string[] = [];
  const step = Math.max(1, maxTokens - overlapTokens);
  for (let i = 0; i < tokens.length; i += step) {
    const slice = tokens.slice(i, i + maxTokens);
    if (slice.length === 0) continue;
    chunks.push(slice.join(" "));
    if (i + maxTokens >= tokens.length) break;
  }
  return chunks;
}

export function buildEmbedIntro(input: EmbedIntroInput): string[] {
  return [
    `Chunking ${input.documents} documents by token count...`,
    `Embedding ${input.documents} documents (${input.chunks} chunks, ${formatKB(input.bytes)})`,
    `${input.splitDocuments} documents split into multiple chunks`,
    `Model: ${input.model}`,
  ];
}

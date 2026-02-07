export type CollectionInput = {
  name: string;
  rootPath: string;
  mask?: string;
};

export type CollectionRow = {
  id: number;
  name: string;
  rootPath: string;
  mask: string;
};

export type ContextInput = {
  target: string;
  value: string;
};

export type IndexStats = {
  added: number;
  updated: number;
  removed: number;
  scanned: number;
  embeddedDocs: number;
  embeddedChunks: number;
  embeddedBytes: number;
  splitDocuments: number;
  cancelled: boolean;
};

export type SearchOptions = {
  query: string;
  limit?: number;
  collection?: string;
  all?: boolean;
  minScore?: number;
};

export type SearchRow = {
  docid: string;
  displayPath: string;
  title: string;
  snippet: string;
  score: number;
};

export type DocumentRow = {
  docid: string;
  displayPath: string;
  title: string;
  content: string;
};

export type GetOptions = {
  fromLine?: number;
  maxLines?: number;
  lineNumbers?: boolean;
};

export type VectorSearchOptions = SearchOptions & {
  host?: string;
  model?: string;
  expanderModel?: string;
  rerankerModel?: string;
  noExpand?: boolean;
  noRerank?: boolean;
};

export type HybridRow = SearchRow & {
  keywordScore?: number;
  vectorScore?: number;
};

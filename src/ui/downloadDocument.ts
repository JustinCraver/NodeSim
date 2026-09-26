import type { GraphDocument } from '../models/types';
import { serializeGraphDocument } from '../document/graphDocument';

export const downloadDocument = (document: GraphDocument) => {
  const blob = new Blob([`${serializeGraphDocument(document)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = 'nodesim-v1.json';
  link.click();
  URL.revokeObjectURL(url);
};

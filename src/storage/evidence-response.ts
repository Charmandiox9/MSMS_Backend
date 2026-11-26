import { extname } from 'node:path';

const previewTypes = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type EvidencePreviewType = (typeof previewTypes)[number];

export function isEvidencePreviewType(
  value: unknown,
): value is EvidencePreviewType {
  return previewTypes.some((type) => type === value);
}

export function evidenceDisposition(
  key: string,
  previewType?: EvidencePreviewType,
) {
  const extension = previewType
    ? { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[
        previewType
      ]
    : extname(key)
        .replace(/[^a-zA-Z0-9.]/g, '')
        .slice(0, 16);
  return `${previewType ? 'inline' : 'attachment'}; filename="evidence${extension}"`;
}

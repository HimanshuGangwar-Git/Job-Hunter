import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { badRequest } from '../http/errors';

export const ALLOWED_CV_TYPES = ['pdf', 'docx'] as const;
export type CvFileType = (typeof ALLOWED_CV_TYPES)[number];

/** Confirms the file's content matches its extension. Extensions alone are never trusted. */
export function detectCvType(fileName: string, buffer: Buffer): CvFileType {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'pdf' && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (ext === 'docx' && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'docx';
  throw badRequest('Upload a PDF or DOCX file whose content matches its extension.');
}

export async function extractCvText(buffer: Buffer, type: CvFileType): Promise<string> {
  let text: string;
  try {
    if (type === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      text = (await extractText(pdf, { mergePages: true })).text;
    } else {
      text = (await mammoth.extractRawText({ buffer })).value;
    }
  } catch {
    throw badRequest('The file could not be read. Check that it is not password-protected or corrupted.');
  }
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length < 40) {
    throw badRequest('No readable text found. Scanned image PDFs are not supported; upload a text-based PDF or DOCX.');
  }
  return normalized;
}

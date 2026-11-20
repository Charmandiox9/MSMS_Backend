import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import {
  attachmentContentDisposition,
  isAllowedTitulationAttachmentType,
  normalizeTitulationAttachmentFilename,
  validateTitulationAttachment,
} from './titulation-attachments.util';
import type { TitulationUploadFile } from './titulation-attachments.util';
import { MAX_STORAGE_UPLOAD_BYTES } from '../storage/storage-transfer-token';

const PDF_CONTENT_TYPE = 'application/pdf';
const WORD_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function uploadFile(
  originalname: string,
  mimetype: string,
  buffer = Buffer.from('%PDF-1.7\nexample'),
): TitulationUploadFile {
  return { originalname, mimetype, buffer, size: buffer.length };
}

describe('titulation attachment validation', () => {
  it('sanitizes uploaded names while preserving a supported extension', () => {
    expect(
      normalizeTitulationAttachmentFilename('C:\\fakepath\\Acta de Grado.pdf'),
    ).toBe('Acta de Grado.pdf');
    expect(normalizeTitulationAttachmentFilename('CON.pdf')).toBe(
      'documento-CON.pdf',
    );
    expect(attachmentContentDisposition('Acta de Grado.pdf')).toContain(
      "filename*=UTF-8''Acta%20de%20Grado.pdf",
    );
  });

  it('accepts a PDF with a matching extension, MIME type and signature', async () => {
    await expect(
      validateTitulationAttachment(uploadFile('acta.pdf', PDF_CONTENT_TYPE)),
    ).resolves.toMatchObject({
      originalName: 'acta.pdf',
      contentType: PDF_CONTENT_TYPE,
      size: expect.any(Number),
    });
  });

  it('rejects unsupported extensions, MIME mismatches, and invalid signatures', async () => {
    expect(
      isAllowedTitulationAttachmentType('acta.exe', 'application/pdf'),
    ).toBe(false);
    await expect(
      validateTitulationAttachment(uploadFile('acta.pdf', 'text/plain')),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateTitulationAttachment(
        uploadFile('acta.pdf', PDF_CONTENT_TYPE, Buffer.from('not a PDF')),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid Word document and rejects arbitrary ZIP files', async () => {
    const archive = new JSZip();
    archive.file('[Content_Types].xml', '<Types/>');
    archive.file('word/document.xml', '<w:document/>');
    const word = await archive.generateAsync({ type: 'nodebuffer' });

    await expect(
      validateTitulationAttachment(
        uploadFile('anexo.docx', WORD_CONTENT_TYPE, word),
      ),
    ).resolves.toMatchObject({
      originalName: 'anexo.docx',
      contentType: WORD_CONTENT_TYPE,
    });

    await expect(
      validateTitulationAttachment(
        uploadFile(
          'anexo.docx',
          WORD_CONTENT_TYPE,
          Buffer.from('PK\u0003\u0004'),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects macro-enabled Word archives and files over 10 MiB', async () => {
    const archive = new JSZip();
    archive.file('[Content_Types].xml', '<Types/>');
    archive.file('word/document.xml', '<w:document/>');
    archive.file('word/vbaProject.bin', 'macro');
    const macroDocument = await archive.generateAsync({ type: 'nodebuffer' });

    await expect(
      validateTitulationAttachment(
        uploadFile('anexo.docx', WORD_CONTENT_TYPE, macroDocument),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateTitulationAttachment(
        uploadFile(
          'acta.pdf',
          PDF_CONTENT_TYPE,
          Buffer.alloc(MAX_STORAGE_UPLOAD_BYTES + 1, 0x25),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

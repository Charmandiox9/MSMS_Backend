import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import {
  availableTitulationDrafts,
  TitulationDraftKind,
} from './titulation-drafts';
import { createTitulationDraftFilename } from './titulation-reference.util';

const DOCUMENT_PART = 'word/document.xml';

export interface GeneratedTitulationDraft {
  content: Buffer;
  filename: string;
}

function wordSlot(value: string | null | undefined, limit: number): string {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (text.length > limit) return '';

  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (
      code < 32 ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      return '';
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return character;
  }).join('');
}

@Injectable()
export class TitulationDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async generateDraft(
    id: string,
    kind: TitulationDraftKind,
  ): Promise<GeneratedTitulationDraft> {
    const isLibrary = kind === TitulationDraftKind.LIBRARY_AUTHORIZATION;
    const isDefense = kind === TitulationDraftKind.DEFENSE_ANNEXES;
    const record = await this.prisma.titulationProcess.findUnique({
      where: { id },
      select: {
        careerName: true,
        createdAt: true,
        studentName: true,
        studentRut: !isLibrary,
        studentEmail: isLibrary,
        studentPhone: isLibrary,
        thesisTopic: !isLibrary,
        guideName: true,
        coGuideName: isDefense,
        reviewerOneName: isDefense,
        reviewerTwoName: isDefense,
        degree: true,
      },
    });
    if (!record || !availableTitulationDrafts(record.careerName).includes(kind))
      throw new NotFoundException('No hay un borrador para este expediente');

    const values: Readonly<Record<string, string>> = {
      STUDENT_NAME: wordSlot(record.studentName, 120),
      STUDENT_RUT: wordSlot(record.studentRut, 12),
      STUDENT_EMAIL: wordSlot(record.studentEmail, 65),
      STUDENT_PHONE: wordSlot(record.studentPhone, 24),
      CAREER_NAME: wordSlot(record.careerName, 100),
      THESIS_TOPIC: wordSlot(record.thesisTopic, isDefense ? 300 : 160),
      GUIDE_NAME: wordSlot(record.guideName, 100),
      CO_GUIDE_NAME: wordSlot(record.coGuideName, 100),
      REVIEWER_ONE_NAME: wordSlot(record.reviewerOneName, 100),
      REVIEWER_TWO_NAME: wordSlot(record.reviewerTwoName, 100),
      DEGREE: wordSlot(record.degree?.toLocaleUpperCase('es-CL') ?? null, 100),
    };
    const zip = await JSZip.loadAsync(
      await readFile(
        join(__dirname, 'templates', `marine-biology-${kind}.docx`),
      ),
    );
    const part = zip.file(DOCUMENT_PART);
    if (!part) throw new Error('La plantilla de Word no contiene un documento');

    const document = await part.async('string');
    const filled = document.replace(
      /MARSYS_([A-Z_]+)_SLOT/g,
      (_, slot: string) => {
        if (!Object.hasOwn(values, slot))
          throw new Error('La plantilla contiene un campo desconocido');
        return values[slot];
      },
    );
    zip.file(DOCUMENT_PART, filled);
    return {
      content: await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      }),
      filename: createTitulationDraftFilename(id, record.createdAt, kind),
    };
  }
}

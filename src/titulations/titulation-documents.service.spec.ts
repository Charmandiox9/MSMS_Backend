import { NotFoundException } from '@nestjs/common';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { TitulationDraftKind } from './titulation-drafts';
import { TitulationDocumentsService } from './titulation-documents.service';

const example = {
  careerName: 'Biología Marina',
  studentName: 'Estudiante <de> Ejemplo & Prueba',
  studentRut: '99999999-9',
  studentEmail: 'example@example.com',
  studentPhone: '+56 9 0000 0000',
  guideName: 'Guía Académica de Ejemplo',
  coGuideName: 'Profesora Coguía de Ejemplo',
  reviewerOneName: 'Docente Revisor de Ejemplo',
  reviewerTwoName: 'Docente Revisora de Ejemplo',
  thesisTopic: 'Diversidad de macroalgas en la bahía',
  degree: 'Bióloga Marina',
};

const templateKind = TitulationDraftKind.THESIS_SUMMARY;

function createService(record: Partial<typeof example> | null = example) {
  const findUnique = jest.fn().mockResolvedValue(record);
  const prisma = { titulationProcess: { findUnique } };
  const service = new TitulationDocumentsService(
    prisma as unknown as PrismaService,
  );
  return { service, findUnique };
}

describe('TitulationDocumentsService', () => {
  it('fills both Word variants and preserves the reserved summary and signature areas', async () => {
    const { service, findUnique } = createService();
    const content = await service.generateDraft('process-1', templateKind);
    const zip = await JSZip.loadAsync(content);
    const xml = await zip.file('word/document.xml')?.async('string');

    expect(
      xml?.match(/Estudiante &lt;de&gt; Ejemplo &amp; Prueba/g),
    ).toHaveLength(2);
    expect(xml?.match(/99999999-9/g)).toHaveLength(2);
    expect(xml).toContain('Diversidad de macroalgas en la bahía');
    expect(xml).toContain('Guía Académica de Ejemplo');
    expect(xml).toContain('BIÓLOGA MARINA');
    expect(xml).toContain('RESUMEN:');
    expect(xml).toContain('Profesor Guía');
    expect(xml).not.toContain('MARSYS_');
    expect(zip.file('word/media/image1.jpeg')).not.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'process-1' },
      select: expect.objectContaining({
        careerName: true,
        studentName: true,
        studentRut: true,
        studentEmail: false,
        studentPhone: false,
        guideName: true,
        thesisTopic: true,
        degree: true,
      }),
    });
  });

  it('fills the annexes committee and removes live mail-merge fields', async () => {
    const { service } = createService();
    const content = await service.generateDraft(
      'process-1',
      TitulationDraftKind.DEFENSE_ANNEXES,
    );
    const zip = await JSZip.loadAsync(content);
    const xml = await zip.file('word/document.xml')?.async('string');

    expect(xml).toContain(example.thesisTopic);
    expect(xml).toContain(example.coGuideName);
    expect(xml).toContain(example.reviewerOneName);
    expect(xml).toContain(example.reviewerTwoName);
    expect(xml).toContain('BIÓLOGA MARINA');
    expect(xml).not.toMatch(/MERGEFIELD|MARSYS_|example@example\.com/);
    expect(xml).not.toMatch(/>[0-7]\.\d</);
  });

  it('prefills the library contact fields while retaining unselected choices', async () => {
    const { service, findUnique } = createService();
    const content = await service.generateDraft(
      'process-1',
      TitulationDraftKind.LIBRARY_AUTHORIZATION,
    );
    const zip = await JSZip.loadAsync(content);
    const xml = await zip.file('word/document.xml')?.async('string');

    expect(xml).toContain(example.studentEmail);
    expect(xml).toContain(example.studentPhone);
    expect(xml).toContain('No autorizo');
    expect(xml).not.toMatch(/MARSYS_|99999999-9|Diversidad de macroalgas/);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'process-1' },
      select: expect.objectContaining({
        studentRut: false,
        studentEmail: true,
        studentPhone: true,
        thesisTopic: false,
      }),
    });
  });

  it('leaves missing or overlong fields blank for manual completion', async () => {
    const longTopic = 'a'.repeat(161);
    const { service } = createService({
      careerName: 'Biología Marina',
      studentName: 'Nombre de prueba',
      thesisTopic: longTopic,
    });
    const content = await service.generateDraft('process-1', templateKind);
    const zip = await JSZip.loadAsync(content);
    const xml = await zip.file('word/document.xml')?.async('string');

    expect(xml).toContain('Nombre de prueba');
    expect(xml).not.toMatch(/MARSYS_|undefined|BIÓLOGO MARINO|DRA\./);
    expect(xml).not.toContain(longTopic);
  });

  it.each([null, { ...example, careerName: 'Otra carrera' }])(
    'does not generate a draft without an eligible record',
    async (record) => {
      const { service } = createService(record);
      await expect(
        service.generateDraft('process-1', templateKind),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );
});

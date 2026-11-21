import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  TitulationDocumentKind,
  TitulationDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { TitulationUploadFile } from './titulation-attachments.util';
import {
  normalizeTitulationAttachmentFilename,
  validateTitulationAttachment,
} from './titulation-attachments.util';

const ATTACHMENT_SUMMARY_SELECT = {
  id: true,
  documentKind: true,
  originalName: true,
  contentType: true,
  size: true,
  createdAt: true,
} satisfies Prisma.TitulationAttachmentSelect;

const DOCUMENT_STATUS_FIELDS = {
  [TitulationDocumentKind.DEFENSE_ANNEXES]: 'defenseAnnexesStatus',
  [TitulationDocumentKind.THESIS_SUMMARY]: 'thesisSummaryStatus',
  [TitulationDocumentKind.LIBRARY_FORM]: 'libraryFormStatus',
  [TitulationDocumentKind.ACTA]: 'actaStatus',
  [TitulationDocumentKind.EVALUATIONS]: 'evaluationsStatus',
} satisfies Record<
  TitulationDocumentKind,
  keyof Prisma.TitulationProcessUpdateInput
>;

@Injectable()
export class TitulationAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(processId: string) {
    await this.assertProcessExists(processId);
    return this.prisma.titulationAttachment.findMany({
      where: { processId },
      select: ATTACHMENT_SUMMARY_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  async upload(
    processId: string,
    file: TitulationUploadFile | undefined,
    documentKind: TitulationDocumentKind,
    documentStatus: TitulationDocumentStatus,
    actorId: string,
  ) {
    await this.assertProcessExists(processId);
    const metadata = await validateTitulationAttachment(file);
    const storageKey = await this.storage.uploadPrivateFile(
      metadata.originalName,
      metadata.contentType,
      metadata.buffer,
    );

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const attachment = await transaction.titulationAttachment.create({
          data: {
            processId,
            documentKind,
            storageKey,
            originalName: metadata.originalName,
            contentType: metadata.contentType,
            size: metadata.size,
            createdById: actorId,
          },
          select: ATTACHMENT_SUMMARY_SELECT,
        });

        await transaction.titulationProcess.update({
          where: { id: processId },
          data: {
            [DOCUMENT_STATUS_FIELDS[documentKind]]: documentStatus,
            updatedById: actorId,
          },
          select: { id: true },
        });

        return attachment;
      });
    } catch (error: unknown) {
      await this.storage.deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async open(processId: string, attachmentId: string, signal: AbortSignal) {
    const attachment = await this.prisma.titulationAttachment.findFirst({
      where: { id: attachmentId, processId },
      select: { storageKey: true, originalName: true },
    });
    if (!attachment)
      throw new NotFoundException('El archivo no pertenece a este expediente');

    const file = await this.storage.downloadFile(attachment.storageKey, signal);
    return {
      ...file,
      originalName: normalizeTitulationAttachmentFilename(
        attachment.originalName,
      ),
    };
  }

  async deleteForProcess(processId: string): Promise<void> {
    const attachments = await this.prisma.titulationAttachment.findMany({
      where: { processId },
      select: { storageKey: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const attachment of attachments) {
      await this.storage.deleteFile(attachment.storageKey);
      await this.prisma.titulationAttachment.delete({
        where: { storageKey: attachment.storageKey },
        select: { id: true },
      });
    }
  }

  private async assertProcessExists(processId: string): Promise<void> {
    const process = await this.prisma.titulationProcess.findUnique({
      where: { id: processId },
      select: { id: true },
    });
    if (!process) throw new NotFoundException('El proceso no existe');
  }
}

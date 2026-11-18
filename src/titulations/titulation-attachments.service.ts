import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { TitulationUploadFile } from './titulation-attachments.util';
import {
  normalizeTitulationAttachmentFilename,
  validateTitulationAttachment,
} from './titulation-attachments.util';

const ATTACHMENT_SUMMARY_SELECT = {
  id: true,
  originalName: true,
  contentType: true,
  size: true,
  createdAt: true,
} satisfies Prisma.TitulationAttachmentSelect;

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
      return await this.prisma.titulationAttachment.create({
        data: {
          processId,
          storageKey,
          originalName: metadata.originalName,
          contentType: metadata.contentType,
          size: metadata.size,
          createdById: actorId,
        },
        select: ATTACHMENT_SUMMARY_SELECT,
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

  private async assertProcessExists(processId: string): Promise<void> {
    const process = await this.prisma.titulationProcess.findUnique({
      where: { id: processId },
      select: { id: true },
    });
    if (!process) throw new NotFoundException('El proceso no existe');
  }
}

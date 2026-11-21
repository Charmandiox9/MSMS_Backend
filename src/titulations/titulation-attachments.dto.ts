import {
  TitulationDocumentKind,
  TitulationDocumentStatus,
} from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CreateTitulationAttachmentDto {
  @IsEnum(TitulationDocumentKind)
  documentKind!: TitulationDocumentKind;

  @IsEnum(TitulationDocumentStatus)
  documentStatus!: TitulationDocumentStatus;
}

import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateTitulationDto,
  ListTitulationsDto,
  UpdateTitulationDto,
} from './titulations.dto';
import { TitulationsService } from './titulations.service';
import { TitulationDraftKind } from './titulation-drafts';
import { TitulationDocumentsService } from './titulation-documents.service';

const TITULATION_READ_ROLES = [
  'ACADEMIC_SECRETARY',
  'ACADEMIC_PROCESS_ANALYST',
  'TEACHING_SUPPORT_COORDINATOR',
];

const TITULATION_MANAGE_ROLES = [
  'ACADEMIC_SECRETARY',
  'TEACHING_SUPPORT_COORDINATOR',
];

@Controller('academic/titulations')
export class TitulationsController {
  constructor(
    private readonly service: TitulationsService,
    private readonly documents: TitulationDocumentsService,
  ) {}

  @Post('search')
  @Roles(...TITULATION_READ_ROLES)
  search(@Body() query: ListTitulationsDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles(...TITULATION_READ_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Get(':id/documents/:kind')
  @Roles(...TITULATION_MANAGE_ROLES)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ParseEnumPipe(TitulationDraftKind))
    kind: TitulationDraftKind,
  ) {
    const { content, filename } = await this.documents.generateDraft(id, kind);
    return new StreamableFile(content, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post()
  @Roles(...TITULATION_MANAGE_ROLES)
  create(
    @Body() input: CreateTitulationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(':id')
  @Roles(...TITULATION_MANAGE_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateTitulationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(id, input, user.id);
  }
}

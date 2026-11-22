import { BadRequestException } from '@nestjs/common';
import {
  EditorialFileKind,
  EditorialFileStatus,
  EditorialKind,
} from '@prisma/client';
import type { EditorialRevisionView } from './editorial.graphql';

export function validatePublication(
  kind: EditorialKind,
  revision: EditorialRevisionView,
) {
  if (!revision.topic || !revision.titleEs || !revision.summaryEs) {
    throw new BadRequestException(
      'Completa el módulo, el título y el resumen en español',
    );
  }

  if (
    revision.files.some((file) => file.status !== EditorialFileStatus.READY)
  ) {
    throw new BadRequestException('Hay archivos pendientes de validar');
  }

  const { files } = revision;
  const videos = files.filter((file) => file.kind === EditorialFileKind.VIDEO);
  const captions = files.filter(
    (file) => file.kind === EditorialFileKind.CAPTIONS,
  );
  if (
    captions.some(
      (caption) => !videos.some((video) => video.id === caption.videoId),
    )
  ) {
    throw new BadRequestException(
      'Incluye la cápsula asociada a cada archivo de subtítulos',
    );
  }
  if (
    videos.some(
      (video) =>
        !captions.some(
          (caption) =>
            caption.videoId === video.id && caption.language === video.language,
        ),
    )
  ) {
    throw new BadRequestException(
      'Cada cápsula necesita subtítulos en su idioma',
    );
  }

  if (kind === EditorialKind.NEWS && !revision.bodyEs) {
    throw new BadRequestException(
      'Explica el cambio en el cuerpo de la novedad',
    );
  }
  if (
    kind === EditorialKind.GUIDE &&
    !revision.bodyEs &&
    !videos.length &&
    !files.some((file) => file.kind === EditorialFileKind.PDF)
  ) {
    throw new BadRequestException(
      'Agrega instrucciones, un PDF o una cápsula con subtítulos',
    );
  }

  const englishFields = [
    revision.titleEn,
    revision.summaryEn,
    ...(revision.bodyEs ? [revision.bodyEn] : []),
  ];
  const hasEnglish = Boolean(
    revision.titleEn || revision.summaryEn || revision.bodyEn,
  );
  if (hasEnglish && !englishFields.every(Boolean)) {
    throw new BadRequestException(
      'Completa la traducción al inglés o déjala vacía',
    );
  }
}

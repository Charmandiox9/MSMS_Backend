import { EditorialKind, EditorialTopic } from '@prisma/client';
import type {
  EditorialFileView,
  EditorialRevisionView,
} from './editorial.graphql';
import { validatePublication } from './editorial-publication.rules';

const revision: EditorialRevisionView = {
  number: 1,
  topic: EditorialTopic.STUDENTS,
  titleEs: 'Una guía',
  summaryEs: 'Resumen',
  bodyEs: '',
  titleEn: null,
  summaryEn: null,
  bodyEn: null,
  destination: null,
  guideId: null,
  files: [],
};

const video: EditorialFileView = {
  id: 'video',
  kind: 'VIDEO',
  status: 'READY',
  language: 'ES',
  fileName: 'video.mp4',
  size: 100,
  duration: 30,
  videoId: null,
};

const caption: EditorialFileView = {
  id: 'captions',
  kind: 'CAPTIONS',
  status: 'READY',
  language: 'ES',
  fileName: 'caps.vtt',
  size: 50,
  duration: null,
  videoId: 'video',
};

describe('editorial publication requirements', () => {
  it('requires instructions or a usable resource for a guide and text for news', () => {
    expect(() => validatePublication(EditorialKind.GUIDE, revision)).toThrow(
      'Agrega instrucciones',
    );
    expect(() =>
      validatePublication(EditorialKind.NEWS, {
        ...revision,
        files: [video, caption],
      }),
    ).toThrow('cuerpo de la novedad');
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        bodyEs: 'Abre Estudiantes.',
      }),
    ).not.toThrow();
  });

  it('requires validated captions in the language of each video', () => {
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, { ...caption, language: 'EN' }],
      }),
    ).toThrow('subtítulos en su idioma');
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, { ...caption, status: 'UPLOADING' }],
      }),
    ).toThrow('pendientes');
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, caption],
      }),
    ).not.toThrow();
  });

  it('accepts Spanish alone or a complete English translation', () => {
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        bodyEs: 'Abre Estudiantes.',
        titleEn: 'Students',
      }),
    ).toThrow('traducción');
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, caption],
        titleEn: 'Guide',
        summaryEn: 'Summary',
      }),
    ).not.toThrow();
  });
});

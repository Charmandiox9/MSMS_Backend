import { EditorialKind, EditorialTopic } from '@prisma/client';
import type {
  EditorialFileView,
  EditorialRevisionView,
} from './editorial.graphql';
import { validatePublication } from './editorial-publication.rules';

const revision: EditorialRevisionView = {
  roleCodes: [],
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

  it('accepts videos with optional captions, including captions in another language', () => {
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video],
      }),
    ).not.toThrow();
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, { ...caption, language: 'EN' }],
      }),
    ).not.toThrow();
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, caption],
      }),
    ).not.toThrow();
  });

  it('requires attached captions to be validated and linked to an included video', () => {
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, { ...caption, status: 'UPLOADING' }],
      }),
    ).toThrow('pendientes');
    expect(() =>
      validatePublication(EditorialKind.GUIDE, {
        ...revision,
        files: [video, { ...caption, videoId: 'other-video' }],
      }),
    ).toThrow('Incluye la cápsula asociada');
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

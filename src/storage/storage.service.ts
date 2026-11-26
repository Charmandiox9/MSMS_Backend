import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
  NotFoundException,
  BadRequestException,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { extname } from 'path';
import { Readable } from 'node:stream';
import type { StorageTransfer } from './storage-transfer-token';

const MAX_TRANSFER_TTL_SECONDS = 300;

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface PresignedDownload {
  downloadUrl: string;
  expiresIn: number;
}

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly provider: string;
  private readonly bucketName: string | undefined;
  private readonly presignedUrlExpiresIn: number;
  private readonly client: S3Client | undefined;
  private readonly signingClient: S3Client | undefined;
  private readonly streamClient: S3Client | undefined;

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    if (
      !['backend', 'direct'].includes(
        configService.get<string>('STORAGE_TRANSFER_MODE', 'backend'),
      )
    )
      throw new Error('STORAGE_TRANSFER_MODE debe ser backend o direct');
    this.provider = this.configService.get<string>('STORAGE_PROVIDER', 'none');
    const isR2 = this.provider === 'r2';
    this.bucketName = this.configService.get<string>(
      isR2 ? 'R2_BUCKET_NAME' : 'S3_BUCKET_NAME',
    );
    this.presignedUrlExpiresIn = this.getExpiresIn();

    if (!['r2', 's3', 'minio'].includes(this.provider)) return;

    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>(
      isR2 ? 'R2_ACCESS_KEY_ID' : 'S3_ACCESS_KEY',
    );
    const secretAccessKey = this.configService.get<string>(
      isR2 ? 'R2_SECRET_ACCESS_KEY' : 'S3_SECRET_KEY',
    );

    if (
      (isR2 && !accountId) ||
      !accessKeyId ||
      !secretAccessKey ||
      !this.bucketName
    ) {
      throw new Error(
        isR2
          ? 'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME son obligatorias cuando STORAGE_PROVIDER=r2'
          : 'S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY y S3_BUCKET_NAME son obligatorias para almacenamiento S3',
      );
    }

    const endpoint = isR2
      ? this.configService.get<string>('R2_ENDPOINT')?.trim() ||
        `https://${accountId}.r2.cloudflarestorage.com`
      : this.configService.get<string>('S3_ENDPOINT');
    if (!endpoint) throw new Error('S3_ENDPOINT es obligatorio');
    if (this.usesBackendTransfer()) this.transferSecret();
    const publicEndpoint =
      (this.usesBackendTransfer()
        ? endpoint
        : this.configService.get<string>('S3_PUBLIC_ENDPOINT')?.trim()) ||
      endpoint;
    const options = {
      region: isR2
        ? 'auto'
        : this.configService.get<string>('S3_REGION', 'us-east-1'),
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: { connectionTimeout: 2000, requestTimeout: 120000 },
    };

    this.client = new S3Client({
      endpoint,
      ...options,
    });
    // A precomputed Content-MD5 keeps streamed PUTs interoperable with R2 and S3.
    this.streamClient = new S3Client({
      endpoint,
      ...options,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    this.signingClient =
      isR2 || publicEndpoint === endpoint
        ? this.client
        : new S3Client({ ...options, endpoint: publicEndpoint });
  }

  async checkHealth(): Promise<void> {
    if (!this.client || !this.bucketName)
      throw new ServiceUnavailableException('Almacenamiento no configurado');
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
  }

  onModuleDestroy() {
    this.client?.destroy();
    this.streamClient?.destroy();
    if (this.signingClient !== this.client) this.signingClient?.destroy();
  }

  async createPresignedUpload(
    fileName: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    if (!this.signingClient || !this.bucketName) {
      throw new ServiceUnavailableException(
        'El almacenamiento de objetos no está habilitado en este entorno',
      );
    }

    const key = this.buildObjectKey(fileName);
    if (this.usesBackendTransfer()) {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(contentType))
        throw new BadRequestException('El archivo debe ser PDF, JPG o PNG');
      return {
        key,
        uploadUrl: await this.createTransferUrl('upload', key, contentType),
        expiresIn: this.presignedUrlExpiresIn,
      };
    }
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn: this.presignedUrlExpiresIn,
    });

    return { key, uploadUrl, expiresIn: this.presignedUrlExpiresIn };
  }

  async createPresignedDownload(key: string): Promise<PresignedDownload> {
    if (!this.signingClient || !this.bucketName) {
      throw new ServiceUnavailableException(
        'El almacenamiento de objetos no está habilitado en este entorno',
      );
    }

    if (
      this.usesBackendTransfer() &&
      !this.isEvidenceKey(key.replace(/^\//, ''))
    )
      throw new NotFoundException('Archivo no encontrado');
    const resolvedKey = await this.resolveExistingKey(key);
    if (this.usesBackendTransfer()) {
      return {
        downloadUrl: await this.createTransferUrl('download', resolvedKey),
        expiresIn: this.presignedUrlExpiresIn,
      };
    }
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: resolvedKey,
    });
    const downloadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn: this.presignedUrlExpiresIn,
    });

    return { downloadUrl, expiresIn: this.presignedUrlExpiresIn };
  }

  async verifyTransfer(
    token: string | undefined,
    action: StorageTransfer['action'],
  ) {
    if (!this.usesBackendTransfer())
      throw new ServiceUnavailableException(
        'Transferencia backend deshabilitada',
      );
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('URL de archivo inválida o caducada');
    const grant = await this.cache.get<StorageTransfer>(
      this.transferCacheKey(token),
    );
    if (
      !grant ||
      grant.action !== action ||
      grant.expiresAt <= Date.now() ||
      !this.isEvidenceKey(grant.key)
    )
      throw new UnauthorizedException('URL de archivo inválida o caducada');
    return grant;
  }

  async uploadFile(
    key: string,
    contentType: string,
    body: Buffer,
    signal: AbortSignal,
  ) {
    await this.putFile(key, contentType, body, body.length, signal);
  }

  async uploadStream(
    key: string,
    contentType: string,
    body: Readable,
    length: number,
    signal: AbortSignal,
    contentMd5: string,
  ) {
    await this.putFile(key, contentType, body, length, signal, contentMd5);
  }

  private async putFile(
    key: string,
    contentType: string,
    body: Buffer | Readable,
    length: number,
    signal: AbortSignal,
    contentMd5?: string,
  ) {
    const client = contentMd5 ? this.streamClient : this.client;
    if (!client || !this.bucketName)
      throw new ServiceUnavailableException('Almacenamiento no configurado');
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: length,
          ...(contentMd5 ? { ContentMD5: contentMd5 } : {}),
        }),
        { abortSignal: signal },
      );
    } catch {
      throw new ServiceUnavailableException('No se pudo guardar el archivo');
    }
  }

  async uploadPrivateFile(
    fileName: string,
    contentType: string,
    body: Buffer,
  ): Promise<string> {
    const key = this.buildObjectKey(fileName, 'titulation-attachments');
    await this.uploadFile(key, contentType, body, new AbortController().signal);
    return key;
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.client || !this.bucketName)
      throw new ServiceUnavailableException('Almacenamiento no configurado');
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
    } catch {
      throw new ServiceUnavailableException('No se pudo eliminar el archivo');
    }
  }

  async downloadFile(key: string, signal: AbortSignal, range?: string) {
    if (!this.client || !this.bucketName)
      throw new ServiceUnavailableException('Almacenamiento no configurado');
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          ...(range ? { Range: range } : {}),
        }),
        { abortSignal: signal },
      );
      if (!(result.Body instanceof Readable)) throw new Error('Missing stream');
      return {
        body: result.Body,
        length: result.ContentLength,
        ...(result.ContentRange ? { contentRange: result.ContentRange } : {}),
      };
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        ['NoSuchKey', 'NotFound'].includes(String(error.name))
      )
        throw new NotFoundException('Archivo no encontrado');
      throw new ServiceUnavailableException('No se pudo obtener el archivo');
    }
  }

  private usesBackendTransfer() {
    return (
      this.configService.get<string>('STORAGE_TRANSFER_MODE', 'backend') !==
      'direct'
    );
  }

  private transferSecret() {
    const secret = this.configService.get<string>('STORAGE_TRANSFER_SECRET');
    if (
      !secret ||
      secret.trim().length < 32 ||
      secret === this.configService.get<string>('JWT_SECRET')
    )
      throw new Error(
        'Configura STORAGE_TRANSFER_SECRET con al menos 32 caracteres y distinto de JWT_SECRET',
      );
    return secret;
  }

  private transferCacheKey(token: string): string {
    const digest = createHmac('sha256', this.transferSecret())
      .update(token)
      .digest('hex');
    return `storage:evidence:v2:${digest}`;
  }

  private isEvidenceKey(key: string): boolean {
    return ['uploads/', `${this.bucketName}/uploads/`].some(
      (prefix) =>
        key.startsWith(prefix) &&
        !key
          .slice(prefix.length)
          .split('/')
          .some(
            (part) =>
              !part || part === '.' || part === '..' || part.includes('\\'),
          ),
    );
  }

  private async createTransferUrl(
    action: 'upload' | 'download',
    key: string,
    contentType?: string,
  ) {
    if (!this.isEvidenceKey(key))
      throw new NotFoundException('Archivo no encontrado');
    const frontend = this.configService.get<string>('FRONTEND_URL');
    const base =
      this.configService.get<string>('PUBLIC_API_URL')?.trim() ||
      (frontend ? `${frontend.replace(/\/$/, '')}/api` : undefined);
    if (!base)
      throw new ServiceUnavailableException(
        'Configura PUBLIC_API_URL o FRONTEND_URL',
      );
    const url = new URL(`${base.replace(/\/$/, '')}/storage/files/${action}`);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new ServiceUnavailableException('PUBLIC_API_URL inválida');
    url.search = '';
    const token = randomBytes(32).toString('base64url');
    const ttl = this.presignedUrlExpiresIn * 1000;
    await this.cache.set<StorageTransfer>(
      this.transferCacheKey(token),
      {
        action,
        key,
        ...(contentType ? { contentType } : {}),
        expiresAt: Date.now() + ttl,
      },
      ttl,
    );
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async resolveExistingKey(key: string): Promise<string> {
    if (!this.client || !this.bucketName) return key;

    const normalized = key.startsWith('/') ? key.slice(1) : key;

    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: normalized }),
      );
      return normalized;
    } catch {
      if (!normalized.startsWith(`${this.bucketName}/`)) {
        const prefixedKey = `${this.bucketName}/${normalized}`;
        try {
          await this.client.send(
            new HeadObjectCommand({
              Bucket: this.bucketName,
              Key: prefixedKey,
            }),
          );
          return prefixedKey;
        } catch {
          return normalized;
        }
      } else {
        const strippedKey = normalized.replace(
          new RegExp(`^${this.bucketName}/`),
          '',
        );
        try {
          await this.client.send(
            new HeadObjectCommand({
              Bucket: this.bucketName,
              Key: strippedKey,
            }),
          );
          return strippedKey;
        } catch {
          return normalized;
        }
      }
    }
  }

  private buildObjectKey(fileName: string, prefix = 'uploads'): string {
    const extension = extname(fileName)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    return `${prefix}/${randomUUID()}${extension}`;
  }

  private getExpiresIn(): number {
    const configured = Number(
      this.configService.get<string>(
        this.provider === 'r2'
          ? 'R2_PRESIGNED_URL_EXPIRES_IN'
          : 'S3_PRESIGNED_URL_EXPIRES_IN',
        '900',
      ),
    );
    const expiresIn =
      Number.isInteger(configured) && configured > 0 && configured <= 3600
        ? configured
        : 900;
    return this.usesBackendTransfer()
      ? Math.min(expiresIn, MAX_TRANSFER_TTL_SECONDS)
      : expiresIn;
  }
}

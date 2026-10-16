import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Readable } from 'node:stream';
import {
  signStorageTransfer,
  verifyStorageTransfer,
} from './storage-transfer-token';

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

  constructor(private readonly configService: ConfigService) {
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
        uploadUrl: this.createTransferUrl('upload', key, contentType),
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

    const resolvedKey = await this.resolveExistingKey(key);
    if (this.usesBackendTransfer()) {
      return {
        downloadUrl: this.createTransferUrl('download', resolvedKey),
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

  verifyTransfer(token: string | undefined, action: 'upload' | 'download') {
    if (!this.usesBackendTransfer())
      throw new ServiceUnavailableException(
        'Transferencia backend deshabilitada',
      );
    return verifyStorageTransfer(token, action, this.transferSecret());
  }

  async uploadFile(
    key: string,
    contentType: string,
    body: Buffer,
    signal: AbortSignal,
  ) {
    if (!this.client || !this.bucketName)
      throw new ServiceUnavailableException('Almacenamiento no configurado');
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
        { abortSignal: signal },
      );
    } catch {
      throw new ServiceUnavailableException('No se pudo guardar el archivo');
    }
  }

  async downloadFile(key: string, signal: AbortSignal) {
    if (!this.client || !this.bucketName)
      throw new ServiceUnavailableException('Almacenamiento no configurado');
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
        { abortSignal: signal },
      );
      if (!(result.Body instanceof Readable)) throw new Error('Missing stream');
      return { body: result.Body, length: result.ContentLength };
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
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException(
        'Configura JWT_SECRET con al menos 32 caracteres',
      );
    return secret;
  }

  private createTransferUrl(
    action: 'upload' | 'download',
    key: string,
    contentType?: string,
  ) {
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
    url.searchParams.set(
      'token',
      signStorageTransfer(
        {
          action,
          key,
          ...(contentType ? { contentType } : {}),
          expiresAt: Date.now() + this.presignedUrlExpiresIn * 1000,
        },
        this.transferSecret(),
      ),
    );
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

  private buildObjectKey(fileName: string): string {
    const extension = extname(fileName)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    return `uploads/${randomUUID()}${extension}`;
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
    return Number.isInteger(configured) && configured > 0 && configured <= 3600
      ? configured
      : 900;
  }
}

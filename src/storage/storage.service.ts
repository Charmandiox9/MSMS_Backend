import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';

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
export class StorageService {
  private readonly provider: string;
  private readonly bucketName: string | undefined;
  private readonly presignedUrlExpiresIn: number;
  private readonly client: S3Client | undefined;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.configService.get<string>('STORAGE_PROVIDER', 'none');
    this.bucketName = this.configService.get<string>('R2_BUCKET_NAME');
    this.presignedUrlExpiresIn = this.getExpiresIn();

    if (this.provider !== 'r2') return;

    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'R2_SECRET_ACCESS_KEY',
    );

    if (!accountId || !accessKeyId || !secretAccessKey || !this.bucketName) {
      throw new Error(
        'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME son obligatorias cuando STORAGE_PROVIDER=r2',
      );
    }

    const endpoint =
      this.configService.get<string>('R2_ENDPOINT') ??
      `https://${accountId}.r2.cloudflarestorage.com`;

    this.client = new S3Client({
      endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async createPresignedUpload(
    fileName: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    if (this.provider !== 'r2' || !this.client || !this.bucketName) {
      throw new ServiceUnavailableException(
        'El almacenamiento R2 no está habilitado en este entorno',
      );
    }

    const key = this.buildObjectKey(fileName);
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.presignedUrlExpiresIn,
    });

    return { key, uploadUrl, expiresIn: this.presignedUrlExpiresIn };
  }

  async createPresignedDownload(key: string): Promise<PresignedDownload> {
    if (this.provider !== 'r2' || !this.client || !this.bucketName) {
      throw new ServiceUnavailableException(
        'El almacenamiento R2 no está habilitado en este entorno',
      );
    }

    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.presignedUrlExpiresIn,
    });

    return { downloadUrl, expiresIn: this.presignedUrlExpiresIn };
  }

  private buildObjectKey(fileName: string): string {
    const extension = extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, '');
    return `uploads/${randomUUID()}${extension}`;
  }

  private getExpiresIn(): number {
    const configured = Number(
      this.configService.get<string>('R2_PRESIGNED_URL_EXPIRES_IN', '900'),
    );
    return Number.isInteger(configured) && configured > 0 && configured <= 3600
      ? configured
      : 900;
  }
}

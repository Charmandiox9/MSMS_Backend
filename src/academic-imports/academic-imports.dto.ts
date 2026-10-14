import { IsBase64, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WorkbookImportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(18_000_000)
  @IsBase64()
  fileBase64!: string;
}

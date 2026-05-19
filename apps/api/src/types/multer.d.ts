declare module "multer" {
  import type { Request, RequestHandler } from "express";

  interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
  }

  interface StorageEngine {
    _handleFile(
      req: Request,
      file: File,
      cb: (error?: unknown, info?: Partial<File>) => void
    ): void;
    _removeFile(
      req: Request,
      file: File,
      cb: (error: Error | null) => void
    ): void;
  }

  interface DiskStorageOptions {
    destination?:
      | string
      | ((
          req: Request,
          file: File,
          cb: (error: Error | null, destination: string) => void
        ) => void);
    filename?: (
      req: Request,
      file: File,
      cb: (error: Error | null, filename: string) => void
    ) => void;
  }

  interface Options {
    dest?: string;
    storage?: StorageEngine;
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
    preservePath?: boolean;
    fileFilter?: (
      req: Request,
      file: File,
      cb: (error: Error | null, acceptFile?: boolean) => void
    ) => void;
  }

  interface Multer {
    single(fieldname: string): RequestHandler;
    array(fieldname: string, maxCount?: number): RequestHandler;
    fields(fields: { name: string; maxCount?: number }[]): RequestHandler;
    none(): RequestHandler;
    any(): RequestHandler;
  }

  interface MulterStatic {
    (options?: Options): Multer;
    diskStorage(options: DiskStorageOptions): StorageEngine;
    memoryStorage(): StorageEngine;
  }

  const multer: MulterStatic;
  export = multer;
}

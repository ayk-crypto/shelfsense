import type { AuthUser } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
      file?: {
        fieldname: string;
        originalname: string;
        encoding: string;
        mimetype: string;
        size: number;
        destination: string;
        filename: string;
        path: string;
        buffer: Buffer;
      };
      files?:
        | { [fieldname: string]: Express.Request["file"][] }
        | Express.Request["file"][];
    }
  }
}

export {};

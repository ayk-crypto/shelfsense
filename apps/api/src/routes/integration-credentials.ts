import crypto from "node:crypto";
import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireActiveWorkspace, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const integrationCredentialsRouter = Router();
integrationCredentialsRouter.use(requireAuth);
integrationCredentialsRouter.use(requireActiveWorkspace);
integrationCredentialsRouter.use(requireRole([Role.OWNER]));

function workspaceId(req: any){
  return req.user?.workspaceId as string | undefined;
}

integrationCredentialsRouter.get("/cost-control", asyncHandler(async (req,res)=>{
  const wid=workspaceId(req);
  if(!wid)return res.status(403).json({error:"Workspace access required"});
  const rows=await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id","name","scopes","lastUsedAt","expiresAt","revokedAt","createdAt"
       FROM "IntegrationCredential"
      WHERE "workspaceId"=$1::uuid
      ORDER BY "createdAt" DESC`,wid,
  );
  res.json({credentials:rows});
}));

integrationCredentialsRouter.post("/cost-control", asyncHandler(async (req,res)=>{
  const wid=workspaceId(req);
  if(!wid)return res.status(403).json({error:"Workspace access required"});
  const token=`ss_cc_${crypto.randomBytes(32).toString("base64url")}`;
  const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
  const name=String(req.body?.name||"Cost Control").trim().slice(0,120)||"Cost Control";
  const expiresAt=req.body?.expiresAt?new Date(req.body.expiresAt):null;
  if(expiresAt&&Number.isNaN(expiresAt.getTime()))return res.status(400).json({error:"Invalid expiry date"});
  const rows=await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "IntegrationCredential" ("workspaceId","name","tokenHash","scopes","expiresAt")
     VALUES ($1::uuid,$2,$3,ARRAY['items:read','costs:read']::text[],$4)
     RETURNING "id","name","scopes","expiresAt","createdAt"`,
    wid,name,tokenHash,expiresAt,
  );
  res.status(201).json({credential:rows[0],token,warning:"Copy this token now. It will not be shown again."});
}));

integrationCredentialsRouter.delete("/cost-control/:id", asyncHandler(async (req,res)=>{
  const wid=workspaceId(req);
  if(!wid)return res.status(403).json({error:"Workspace access required"});
  const count=await prisma.$executeRawUnsafe(
    `UPDATE "IntegrationCredential" SET "revokedAt"=NOW()
      WHERE "id"=$1::uuid AND "workspaceId"=$2::uuid AND "revokedAt" IS NULL`,
    req.params.id,wid,
  );
  if(!count)return res.status(404).json({error:"Integration credential not found"});
  res.json({ok:true});
}));

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(async (req, res) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  const trimmedName = name?.trim();
  const trimmedEmail = email?.trim().toLowerCase();

  if (!trimmedName || !trimmedEmail || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: trimmedEmail },
    select: { id: true },
  });

  if (existingUser) {
    return res.status(409).json({ error: "Email is already registered" });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name: trimmedName,
      email: trimmedEmail,
      password: hashedPassword,
    },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  return res.status(201).json({
    user,
    token: signToken(user.id),
  });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  const trimmedEmail = email?.trim().toLowerCase();

  if (!trimmedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await prisma.user.findUnique({
    where: { email: trimmedEmail },
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const passwordMatches = await bcrypt.compare(password, user.password);

  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    },
    token: signToken(user.id),
  });
}));

function signToken(userId: string) {
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn: "7d" });
}

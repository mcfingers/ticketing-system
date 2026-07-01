import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware";
import { sendVerificationEmail, APP_BASE_URL } from "../mailer";

export const authRouter = Router();

// How long an email-verification token stays valid.
const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const resendSchema = z.object({
  email: z.string().email(),
});

function publicUser(u: { id: string; email: string; name: string }) {
  return { id: u.id, email: u.email, name: u.name };
}

/** Creates a fresh verification token + expiry (24h from now). */
function newVerificationToken() {
  return {
    token: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
  };
}

/** Redirects the email-link click back to the web login screen with a status. */
function loginRedirect(status: "verified" | "expired" | "invalid"): string {
  return `${APP_BASE_URL}/login?verified=${status}`;
}

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { email, name, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const hash = await bcrypt.hash(password, 10);
  const { token, expiresAt } = newVerificationToken();
  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: hash,
      emailVerified: false,
      verificationToken: token,
      verificationTokenExpiresAt: expiresAt,
    },
  });

  // Do NOT start a session: the account is inactive until verified.
  try {
    await sendVerificationEmail(user.email, user.name, token);
  } catch (err) {
    console.error("[auth] failed to send verification email:", err);
    return res.status(502).json({
      error: "Account created, but the verification email could not be sent. Please use 'Resend' to try again.",
    });
  }

  res.status(201).json({
    message: "Account created. Check your email for a verification link to activate your account.",
    email: user.email,
  });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Block sign-in until the email address has been confirmed.
  if (!user.emailVerified) {
    return res.status(403).json({
      error: "Please verify your email before signing in. Check your inbox for the verification link.",
      needsVerification: true,
    });
  }

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

// Verification link target (clicked from the email). On success the user is
// redirected to the web login screen; failures redirect with a status flag.
authRouter.get("/verify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    return res.redirect(loginRedirect("invalid"));
  }

  const user = await prisma.user.findUnique({ where: { verificationToken: token } });
  if (!user) {
    return res.redirect(loginRedirect("invalid"));
  }

  // Already verified (e.g. link clicked twice) — treat as success.
  if (user.emailVerified) {
    return res.redirect(loginRedirect("verified"));
  }

  if (!user.verificationTokenExpiresAt || user.verificationTokenExpiresAt.getTime() < Date.now()) {
    return res.redirect(loginRedirect("expired"));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null },
  });

  res.redirect(loginRedirect("verified"));
});

// Re-send a verification email with a fresh 24h token. Always responds 200 with
// a generic message so it can't be used to probe which emails are registered.
authRouter.post("/resend", async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const { email } = parsed.data;
  const generic = { message: "If an unverified account exists for that email, a new verification link has been sent." };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerified) {
    return res.json(generic);
  }

  const { token, expiresAt } = newVerificationToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { verificationToken: token, verificationTokenExpiresAt: expiresAt },
  });

  try {
    await sendVerificationEmail(user.email, user.name, token);
  } catch (err) {
    console.error("[auth] failed to resend verification email:", err);
    return res.status(502).json({ error: "Could not send the verification email. Please try again later." });
  }

  res.json(generic);
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.session.userId! } });
  if (!user) {
    return req.session.destroy(() => res.status(401).json({ error: "Not authenticated" }));
  }
  res.json({ user: publicUser(user) });
});

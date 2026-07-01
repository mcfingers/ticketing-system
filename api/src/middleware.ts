import { Request, Response, NextFunction } from "express";
import { prisma } from "./db";

/** Rejects the request unless a valid session user exists. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

/**
 * Ensures the logged-in user belongs to the given team.
 * Returns the membership, or sends 403/404 and returns null.
 */
export async function assertMembership(
  req: Request,
  res: Response,
  teamId: string
) {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.session.userId!, teamId } },
  });
  if (!membership) {
    res.status(403).json({ error: "You are not a member of this team" });
    return null;
  }
  return membership;
}

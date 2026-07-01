import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, assertMembership } from "../middleware";

export const teamsRouter = Router();

teamsRouter.use(requireAuth);

const createTeamSchema = z.object({ name: z.string().min(1).max(120) });
const addMemberSchema = z.object({ email: z.string().email() });

// List the teams the current user belongs to.
teamsRouter.get("/", async (req, res) => {
  const memberships = await prisma.teamMember.findMany({
    where: { userId: req.session.userId! },
    include: { team: true },
    orderBy: { team: { name: "asc" } },
  });
  res.json({
    teams: memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      role: m.role,
    })),
  });
});

// Create a team; the creator becomes its admin member.
teamsRouter.post("/", async (req, res) => {
  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const existing = await prisma.team.findUnique({ where: { name: parsed.data.name } });
  if (existing) return res.status(409).json({ error: "A team with that name already exists" });

  const team = await prisma.team.create({
    data: {
      name: parsed.data.name,
      members: { create: { userId: req.session.userId!, role: "admin" } },
    },
  });
  res.status(201).json({ team: { id: team.id, name: team.name, role: "admin" } });
});

// Delete a team. Only an admin of the team may do so, and only when the team
// has no tickets and no epics (to avoid silently cascade-deleting work).
teamsRouter.delete("/:teamId", async (req, res) => {
  const membership = await assertMembership(req, res, req.params.teamId);
  if (!membership) return;

  if (membership.role !== "admin") {
    return res.status(403).json({ error: "Only a team admin can delete the team" });
  }

  const [ticketCount, epicCount] = await Promise.all([
    prisma.ticket.count({ where: { teamId: req.params.teamId } }),
    prisma.epic.count({ where: { teamId: req.params.teamId } }),
  ]);
  if (ticketCount > 0 || epicCount > 0) {
    const parts: string[] = [];
    if (ticketCount > 0) parts.push(`${ticketCount} ticket(s)`);
    if (epicCount > 0) parts.push(`${epicCount} epic(s)`);
    return res.status(409).json({
      error: `Cannot delete a team that still contains ${parts.join(" and ")}. Remove them first.`,
    });
  }

  // Remaining memberships cascade-delete via the schema relation.
  await prisma.team.delete({ where: { id: req.params.teamId } });
  res.json({ ok: true });
});

// List members of a team the user belongs to.
teamsRouter.get("/:teamId/members", async (req, res) => {
  const membership = await assertMembership(req, res, req.params.teamId);
  if (!membership) return;

  const members = await prisma.teamMember.findMany({
    where: { teamId: req.params.teamId },
    include: { user: true },
    orderBy: { joinedAt: "asc" },
  });
  res.json({
    members: members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
  });
});

// Add an existing user (by email) to a team the current user belongs to.
teamsRouter.post("/:teamId/members", async (req, res) => {
  const membership = await assertMembership(req, res, req.params.teamId);
  if (!membership) return;

  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return res.status(404).json({ error: "No registered user with that email" });

  try {
    await prisma.teamMember.create({
      data: { userId: user.id, teamId: req.params.teamId, role: "member" },
    });
  } catch {
    return res.status(409).json({ error: "User is already a member of this team" });
  }
  res.status(201).json({ member: { id: user.id, name: user.name, email: user.email, role: "member" } });
});

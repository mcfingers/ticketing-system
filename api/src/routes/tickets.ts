import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, assertMembership } from "../middleware";

export const ticketsRouter = Router();

ticketsRouter.use(requireAuth);

const STATUSES = ["NEW", "READY_FOR_IMPLEMENTATION", "IN_PROGRESS", "READY_FOR_ACCEPTANCE", "DONE"] as const;
const TYPES = ["BUG", "FEATURE", "FIX"] as const;

const createSchema = z.object({
  teamId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(TYPES).optional(),
  assigneeId: z.string().nullable().optional(),
  epicId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  teamId: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(STATUSES).optional(),
  type: z.enum(TYPES).optional(),
  position: z.number().int().min(0).optional(),
  assigneeId: z.string().nullable().optional(),
  epicId: z.string().nullable().optional(),
});

function serialize(t: any) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    type: t.type,
    position: t.position,
    teamId: t.teamId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    createdBy: t.createdBy ? { id: t.createdBy.id, name: t.createdBy.name } : null,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    epic: t.epic ? { id: t.epic.id, title: t.epic.title } : null,
  };
}

const withPeople = {
  createdBy: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  epic: { select: { id: true, title: true } },
} as const;

// Verify the given user id (if provided) is a member of the team.
async function validateAssignee(teamId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return true;
  const m = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: assigneeId, teamId } },
  });
  return !!m;
}

// Verify the given epic (if provided) exists and belongs to the same team.
async function validateEpic(teamId: string, epicId: string | null | undefined) {
  if (!epicId) return true;
  const epic = await prisma.epic.findUnique({ where: { id: epicId } });
  return !!epic && epic.teamId === teamId;
}

// List all tickets for a team the user belongs to.
ticketsRouter.get("/", async (req, res) => {
  const teamId = String(req.query.teamId || "");
  if (!teamId) return res.status(400).json({ error: "teamId query parameter is required" });

  const membership = await assertMembership(req, res, teamId);
  if (!membership) return;

  const tickets = await prisma.ticket.findMany({
    where: { teamId },
    include: withPeople,
    orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  res.json({ tickets: tickets.map(serialize) });
});

// Create a ticket in a team the user belongs to.
ticketsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { teamId, title, description, type, assigneeId, epicId } = parsed.data;

  const membership = await assertMembership(req, res, teamId);
  if (!membership) return;

  if (!(await validateAssignee(teamId, assigneeId))) {
    return res.status(400).json({ error: "Assignee must be a member of the team" });
  }
  if (!(await validateEpic(teamId, epicId))) {
    return res.status(400).json({ error: "Epic must belong to the same team as the ticket" });
  }

  // Place new tickets at the end of the first column.
  const count = await prisma.ticket.count({ where: { teamId, status: "NEW" } });
  const ticket = await prisma.ticket.create({
    data: {
      teamId,
      title,
      description: description ?? "",
      type: type ?? "FEATURE",
      assigneeId: assigneeId ?? null,
      epicId: epicId ?? null,
      createdById: req.session.userId!,
      status: "NEW",
      position: count,
    },
    include: withPeople,
  });
  res.status(201).json({ ticket: serialize(ticket) });
});

// Update a ticket (move column, reorder, edit, reassign).
ticketsRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Ticket not found" });

  // Must be a member of the ticket's current team to edit it.
  const membership = await assertMembership(req, res, existing.teamId);
  if (!membership) return;

  const teamChanged = parsed.data.teamId !== undefined && parsed.data.teamId !== existing.teamId;
  const targetTeamId = parsed.data.teamId ?? existing.teamId;

  // Moving to another team also requires membership there.
  if (teamChanged) {
    const targetMembership = await assertMembership(req, res, targetTeamId);
    if (!targetMembership) return;
  }

  // Assignee and epic are team-scoped, so a team change invalidates them.
  // Clear each one unless the caller explicitly provided a valid replacement.
  let assigneeId = parsed.data.assigneeId;
  let epicId = parsed.data.epicId;
  if (teamChanged) {
    if (assigneeId === undefined) assigneeId = null;
    if (epicId === undefined) epicId = null;
  }

  if (assigneeId !== undefined && !(await validateAssignee(targetTeamId, assigneeId))) {
    return res.status(400).json({ error: "Assignee must be a member of the team" });
  }
  if (epicId !== undefined && !(await validateEpic(targetTeamId, epicId))) {
    return res.status(400).json({ error: "Epic must belong to the same team as the ticket" });
  }

  const data: any = { ...parsed.data };
  if (assigneeId !== undefined) data.assigneeId = assigneeId;
  if (epicId !== undefined) data.epicId = epicId;
  // On a team move, drop the ticket at the end of its column in the new team.
  if (teamChanged) {
    const status = parsed.data.status ?? existing.status;
    data.position = await prisma.ticket.count({ where: { teamId: targetTeamId, status } });
  }

  const ticket = await prisma.ticket.update({
    where: { id: req.params.id },
    data,
    include: withPeople,
  });
  res.json({ ticket: serialize(ticket) });
});

// Delete a ticket.
ticketsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Ticket not found" });

  const membership = await assertMembership(req, res, existing.teamId);
  if (!membership) return;

  await prisma.ticket.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

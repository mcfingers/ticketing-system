import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, assertMembership } from "../middleware";

export const epicsRouter = Router();

epicsRouter.use(requireAuth);

const createSchema = z.object({
  teamId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
});

function serialize(e: any) {
  return {
    id: e.id,
    teamId: e.teamId,
    title: e.title,
    description: e.description,
    ticketCount: e._count ? e._count.tickets : undefined,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

// List epics for a team the user belongs to.
epicsRouter.get("/", async (req, res) => {
  const teamId = String(req.query.teamId || "");
  if (!teamId) return res.status(400).json({ error: "teamId query parameter is required" });

  const membership = await assertMembership(req, res, teamId);
  if (!membership) return;

  const epics = await prisma.epic.findMany({
    where: { teamId },
    include: { _count: { select: { tickets: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ epics: epics.map(serialize) });
});

// Create an epic in a team the user belongs to.
epicsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { teamId, title, description } = parsed.data;

  const membership = await assertMembership(req, res, teamId);
  if (!membership) return;

  const epic = await prisma.epic.create({
    data: { teamId, title, description: description ?? "" },
    include: { _count: { select: { tickets: true } } },
  });
  res.status(201).json({ epic: serialize(epic) });
});

// Edit an epic's title/description.
epicsRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const existing = await prisma.epic.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Epic not found" });

  const membership = await assertMembership(req, res, existing.teamId);
  if (!membership) return;

  const epic = await prisma.epic.update({
    where: { id: req.params.id },
    data: parsed.data,
    include: { _count: { select: { tickets: true } } },
  });
  res.json({ epic: serialize(epic) });
});

// Delete an epic, but only when no tickets reference it.
epicsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.epic.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Epic not found" });

  const membership = await assertMembership(req, res, existing.teamId);
  if (!membership) return;

  const ticketCount = await prisma.ticket.count({ where: { epicId: req.params.id } });
  if (ticketCount > 0) {
    return res.status(409).json({
      error: `Cannot delete an epic with tickets. Reassign or remove its ${ticketCount} ticket(s) first.`,
    });
  }

  await prisma.epic.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

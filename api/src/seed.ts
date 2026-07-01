import bcrypt from "bcryptjs";
import { prisma } from "./db";

/**
 * Idempotent seed: creates a demo team, two demo users, and a few tickets
 * only if the database has no users yet. Lets QA log in immediately.
 *
 * Demo credentials:
 *   alice@example.com / password123  (admin of "Demo Team")
 *   bob@example.com   / password123  (member of "Demo Team")
 */
async function main() {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log("[seed] Users already exist; skipping seed.");
    return;
  }

  const hash = await bcrypt.hash("password123", 10);

  // Demo accounts are pre-verified so QA can log in immediately.
  const alice = await prisma.user.create({
    data: { email: "alice@example.com", name: "Alice", password: hash, emailVerified: true },
  });
  const bob = await prisma.user.create({
    data: { email: "bob@example.com", name: "Bob", password: hash, emailVerified: true },
  });

  const team = await prisma.team.create({
    data: {
      name: "Demo Team",
      members: {
        create: [
          { userId: alice.id, role: "admin" },
          { userId: bob.id, role: "member" },
        ],
      },
    },
  });

  await prisma.ticket.createMany({
    data: [
      { teamId: team.id, title: "Set up CI pipeline", description: "Configure build + test on push.", status: "NEW", type: "FEATURE", position: 0, createdById: alice.id, assigneeId: alice.id },
      { teamId: team.id, title: "Design login screen", description: "Email + password form.", status: "IN_PROGRESS", type: "FEATURE", position: 0, createdById: alice.id, assigneeId: bob.id },
      { teamId: team.id, title: "Write API tests", description: "Cover auth and tickets routes.", status: "READY_FOR_ACCEPTANCE", type: "FIX", position: 0, createdById: bob.id, assigneeId: alice.id },
      { teamId: team.id, title: "Fix login redirect bug", description: "Session cookie not set on first login.", status: "READY_FOR_IMPLEMENTATION", type: "BUG", position: 0, createdById: bob.id, assigneeId: bob.id },
      { teamId: team.id, title: "Provision database", description: "Postgres container in compose.", status: "DONE", type: "FEATURE", position: 0, createdById: alice.id, assigneeId: null },
    ],
  });

  console.log("[seed] Created demo team, users (alice/bob @example.com, password123), and tickets.");
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

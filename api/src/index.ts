import "./types";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { authRouter } from "./routes/auth";
import { teamsRouter } from "./routes/teams";
import { ticketsRouter } from "./routes/tickets";
import { epicsRouter } from "./routes/epics";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

const PgSession = connectPgSimple(session);
app.use(
  session({
    name: "sid",
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // QA runs over http on localhost
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/epics", epicsRouter);

// Fallback JSON 404 for unknown API routes.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
});

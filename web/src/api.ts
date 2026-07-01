export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  role: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Epic {
  id: string;
  teamId: string;
  title: string;
  description: string;
  ticketCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type TicketStatus =
  | "NEW"
  | "READY_FOR_IMPLEMENTATION"
  | "IN_PROGRESS"
  | "READY_FOR_ACCEPTANCE"
  | "DONE";

export type TicketType = "BUG" | "FEATURE" | "FIX";

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  type: TicketType;
  position: number;
  teamId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  epic: { id: string; title: string } | null;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Auth
  me: () => request<{ user: User }>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, name: string, password: string) =>
    request<{ message: string; email: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    }),
  resendVerification: (email: string) =>
    request<{ message: string }>("/auth/resend", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  // Teams
  listTeams: () => request<{ teams: Team[] }>("/teams"),
  createTeam: (name: string) =>
    request<{ team: Team }>("/teams", { method: "POST", body: JSON.stringify({ name }) }),
  deleteTeam: (teamId: string) =>
    request<{ ok: boolean }>(`/teams/${teamId}`, { method: "DELETE" }),
  listMembers: (teamId: string) =>
    request<{ members: Member[] }>(`/teams/${teamId}/members`),
  addMember: (teamId: string, email: string) =>
    request<{ member: Member }>(`/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  // Epics
  listEpics: (teamId: string) =>
    request<{ epics: Epic[] }>(`/epics?teamId=${encodeURIComponent(teamId)}`),
  createEpic: (input: { teamId: string; title: string; description?: string }) =>
    request<{ epic: Epic }>("/epics", { method: "POST", body: JSON.stringify(input) }),
  updateEpic: (id: string, patch: Partial<{ title: string; description: string }>) =>
    request<{ epic: Epic }>(`/epics/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteEpic: (id: string) => request<{ ok: boolean }>(`/epics/${id}`, { method: "DELETE" }),

  // Tickets
  listTickets: (teamId: string) =>
    request<{ tickets: Ticket[] }>(`/tickets?teamId=${encodeURIComponent(teamId)}`),
  createTicket: (input: { teamId: string; title: string; description?: string; type?: TicketType; assigneeId?: string | null; epicId?: string | null }) =>
    request<{ ticket: Ticket }>("/tickets", { method: "POST", body: JSON.stringify(input) }),
  updateTicket: (
    id: string,
    patch: Partial<{ teamId: string; title: string; description: string; status: TicketStatus; type: TicketType; position: number; assigneeId: string | null; epicId: string | null }>
  ) => request<{ ticket: Ticket }>(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTicket: (id: string) => request<{ ok: boolean }>(`/tickets/${id}`, { method: "DELETE" }),
};

export { ApiError };

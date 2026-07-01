import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { api, Epic, Member, Team, Ticket, TicketStatus, TicketType } from "../api";
import { useAuth } from "../auth";

const COLUMNS: { id: TicketStatus; title: string }[] = [
  { id: "NEW", title: "New" },
  { id: "READY_FOR_IMPLEMENTATION", title: "Ready for implementation" },
  { id: "IN_PROGRESS", title: "In progress" },
  { id: "READY_FOR_ACCEPTANCE", title: "Ready for acceptance" },
  { id: "DONE", title: "Done" },
];

const TYPE_META: Record<TicketType, { label: string; icon: string; className: string }> = {
  BUG: { label: "Bug", icon: "🐛", className: "type-bug" },
  FEATURE: { label: "Feature", icon: "✨", className: "type-feature" },
  FIX: { label: "Fix", icon: "🔧", className: "type-fix" },
};

export function Board() {
  const { user, logout } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [creating, setCreating] = useState(false);

  // Which toolbar popover is open. Only one at a time; clicking outside any
  // popover (blur) closes it, while the toggle buttons still open/close their own.
  const [openPopover, setOpenPopover] = useState<null | "members" | "epics">(null);
  const togglePopover = (which: "members" | "epics") =>
    setOpenPopover((cur) => (cur === which ? null : which));

  useEffect(() => {
    if (!openPopover) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-popover-root]")) setOpenPopover(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openPopover]);

  // Board filters (combined with AND). "" means "no filter" for that field;
  // the epic filter also supports "__none__" to match tickets without an epic.
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<TicketType | "">("");
  const [filterEpicId, setFilterEpicId] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Load teams once.
  useEffect(() => {
    api.listTeams().then((res) => {
      setTeams(res.teams);
      if (res.teams.length && !activeTeamId) setActiveTeamId(res.teams[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  // Load members + tickets whenever the active team changes.
  useEffect(() => {
    if (!activeTeamId) {
      setTickets([]);
      setMembers([]);
      setEpics([]);
      return;
    }
    Promise.all([api.listMembers(activeTeamId), api.listEpics(activeTeamId), api.listTickets(activeTeamId)])
      .then(([m, e, t]) => {
        setMembers(m.members);
        setEpics(e.epics);
        setTickets(t.tickets);
      })
      .catch((e) => setError(e.message));
  }, [activeTeamId]);

  // Reload epics after CRUD (keeps ticketCount and the ticket board in sync).
  const refreshEpics = () =>
    api.listEpics(activeTeamId).then((e) => setEpics(e.epics)).catch((e) => setError(e.message));

  const refreshTickets = () =>
    api.listTickets(activeTeamId).then((t) => setTickets(t.tickets)).catch((e) => setError(e.message));

  const activeTeam = teams.find((t) => t.id === activeTeamId);

  const deleteActiveTeam = async () => {
    if (!activeTeam) return;
    if (!confirm(`Delete team "${activeTeam.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteTeam(activeTeam.id);
      const remaining = teams.filter((t) => t.id !== activeTeam.id);
      setTeams(remaining);
      setActiveTeamId(remaining[0]?.id ?? "");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const ticket = tickets.find((t) => t.id === active.id);
    const target = over.id as TicketStatus;
    if (!ticket || ticket.status === target) return;

    // Optimistic update.
    const newPos = tickets.filter((t) => t.status === target).length;
    setTickets((prev) =>
      prev.map((t) => (t.id === ticket.id ? { ...t, status: target, position: newPos } : t))
    );
    try {
      await api.updateTicket(ticket.id, { status: target, position: newPos });
    } catch (e: any) {
      setError(e.message);
      refreshTickets();
    }
  };

  const filtersActive = search.trim() !== "" || filterType !== "" || filterEpicId !== "";

  // Apply type + epic + title-search filters with AND logic.
  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filterType && t.type !== filterType) return false;
      if (filterEpicId === "__none__" && t.epic) return false;
      if (filterEpicId && filterEpicId !== "__none__" && t.epic?.id !== filterEpicId) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tickets, search, filterType, filterEpicId]);

  const ticketsByStatus = useMemo(() => {
    const map: Record<TicketStatus, Ticket[]> = { NEW: [], READY_FOR_IMPLEMENTATION: [], IN_PROGRESS: [], READY_FOR_ACCEPTANCE: [], DONE: [] };
    for (const t of filteredTickets) map[t.status].push(t);
    for (const k of Object.keys(map) as TicketStatus[]) map[k].sort((a, b) => a.position - b.position);
    return map;
  }, [filteredTickets]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🎫 TicketTrack</div>
        <div className="topbar-right">
          <span className="muted">{user?.name}</span>
          <button className="ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="toolbar">
        <TeamPicker
          teams={teams}
          activeTeamId={activeTeamId}
          onChange={setActiveTeamId}
          onCreated={(team) => {
            setTeams((prev) => [...prev, team]);
            setActiveTeamId(team.id);
          }}
          onError={setError}
        />
        {activeTeamId && (
          <>
            <MemberManager
              teamId={activeTeamId}
              members={members}
              onAdded={(m) => setMembers((prev) => [...prev, m])}
              onError={setError}
              open={openPopover === "members"}
              onToggle={() => togglePopover("members")}
            />
            <EpicManager
              teamId={activeTeamId}
              epics={epics}
              onChanged={() => {
                refreshEpics();
                refreshTickets();
              }}
              onError={setError}
              open={openPopover === "epics"}
              onToggle={() => togglePopover("epics")}
            />
            <button onClick={() => setCreating(true)}>+ New ticket</button>
            {activeTeam?.role === "admin" && (
              <button className="ghost danger-outline" onClick={deleteActiveTeam}>Delete team</button>
            )}
          </>
        )}
      </div>

      {activeTeamId && (
        <div className="filterbar">
          <input
            className="filter-search"
            type="search"
            placeholder="Search title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as TicketType | "")}>
            <option value="">All types</option>
            {(Object.keys(TYPE_META) as TicketType[]).map((t) => (
              <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label}</option>
            ))}
          </select>
          <select value={filterEpicId} onChange={(e) => setFilterEpicId(e.target.value)}>
            <option value="">All epics</option>
            <option value="__none__">No epic</option>
            {epics.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.title}</option>
            ))}
          </select>
          {filtersActive && (
            <>
              <span className="muted filter-count">
                {filteredTickets.length} of {tickets.length}
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setSearch("");
                  setFilterType("");
                  setFilterEpicId("");
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {error && <div className="alert toolbar-alert" onClick={() => setError("")}>{error} (dismiss)</div>}

      {!teams.length ? (
        <div className="center muted">You're not in any team yet. Create one to get started.</div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="board">
            {COLUMNS.map((col) => (
              <Column key={col.id} status={col.id} title={col.title} count={ticketsByStatus[col.id].length}>
                {ticketsByStatus[col.id].map((t) => (
                  <TicketCard key={t.id} ticket={t} onOpen={() => setEditing(t)} />
                ))}
              </Column>
            ))}
          </div>
        </DndContext>
      )}

      {creating && (
        <TicketModal
          teamId={activeTeamId}
          teams={teams}
          members={members}
          epics={epics}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refreshTickets();
            refreshEpics();
          }}
        />
      )}

      {editing && (
        <TicketModal
          teamId={activeTeamId}
          teams={teams}
          members={members}
          epics={epics}
          ticket={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refreshTickets();
            refreshEpics();
          }}
          onDeleted={() => {
            setEditing(null);
            refreshTickets();
            refreshEpics();
          }}
        />
      )}
    </div>
  );
}

function TeamPicker({
  teams,
  activeTeamId,
  onChange,
  onCreated,
  onError,
}: {
  teams: Team[];
  activeTeamId: string;
  onChange: (id: string) => void;
  onCreated: (team: Team) => void;
  onError: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createTeam(name.trim());
      onCreated(res.team);
      setName("");
      setAdding(false);
    } catch (err: any) {
      onError(err.message);
    }
  };

  return (
    <div className="team-picker">
      <label className="inline">
        Team
        <select value={activeTeamId} onChange={(e) => onChange(e.target.value)}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      {adding ? (
        <form className="inline" onSubmit={create}>
          <input placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          <button type="submit">Create</button>
          <button type="button" className="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <button className="ghost" onClick={() => setAdding(true)}>+ New team</button>
      )}
    </div>
  );
}

function MemberManager({
  teamId,
  members,
  onAdded,
  onError,
  open,
  onToggle,
}: {
  teamId: string;
  members: Member[];
  onAdded: (m: Member) => void;
  onError: (msg: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [email, setEmail] = useState("");

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.addMember(teamId, email.trim());
      onAdded(res.member);
      setEmail("");
    } catch (err: any) {
      onError(err.message);
    }
  };

  return (
    <div className="member-manager" data-popover-root>
      <button className="ghost" onClick={onToggle}>
        Members ({members.length})
      </button>
      {open && (
        <div className="popover card">
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong> <span className="muted">{m.email}</span>
                {m.role === "admin" && <span className="badge">admin</span>}
              </li>
            ))}
          </ul>
          <form className="inline" onSubmit={add}>
            <input type="email" placeholder="Add member by email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button type="submit">Add</button>
          </form>
        </div>
      )}
    </div>
  );
}

function EpicManager({
  teamId,
  epics,
  onChanged,
  onError,
  open,
  onToggle,
}: {
  teamId: string;
  epics: Epic[];
  onChanged: () => void;
  onError: (msg: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createEpic({ teamId, title: title.trim(), description: description.trim() });
      setTitle("");
      setDescription("");
      onChanged();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const startEdit = (epic: Epic) => {
    setEditId(epic.id);
    setEditTitle(epic.title);
    setEditDesc(epic.description);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    try {
      await api.updateEpic(editId, { title: editTitle.trim(), description: editDesc.trim() });
      setEditId(null);
      onChanged();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const remove = async (epic: Epic) => {
    if (!confirm(`Delete epic "${epic.title}"?`)) return;
    try {
      await api.deleteEpic(epic.id);
      onChanged();
    } catch (err: any) {
      onError(err.message);
    }
  };

  return (
    <div className="member-manager" data-popover-root>
      <button className="ghost" onClick={onToggle}>
        Epics ({epics.length})
      </button>
      {open && (
        <div className="popover card">
          <ul className="member-list">
            {epics.length === 0 && <li className="muted">No epics yet.</li>}
            {epics.map((ep) =>
              editId === ep.id ? (
                <li key={ep.id}>
                  <form onSubmit={saveEdit} className="epic-edit">
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required autoFocus />
                    <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} placeholder="Description (optional)" />
                    <div className="inline">
                      <button type="submit">Save</button>
                      <button type="button" className="ghost" onClick={() => setEditId(null)}>Cancel</button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={ep.id} className="epic-row">
                  <div>
                    <strong>{ep.title}</strong>
                    <span className="badge">{ep.ticketCount ?? 0} tickets</span>
                    {ep.description && <div className="hint">{ep.description}</div>}
                  </div>
                  <div className="inline">
                    <button type="button" className="ghost" onClick={() => startEdit(ep)}>Edit</button>
                    <button type="button" className="ghost danger-outline" onClick={() => remove(ep)}>Delete</button>
                  </div>
                </li>
              )
            )}
          </ul>
          <form onSubmit={create} className="epic-create">
            <input placeholder="New epic title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            <button type="submit">Add epic</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Column({
  status,
  title,
  count,
  children,
}: {
  status: TicketStatus;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={`column${isOver ? " column-over" : ""}`}>
      <div className={`column-head status-${status}`}>
        <span>{title}</span>
        <span className="count">{count}</span>
      </div>
      <div className="column-body">{children}</div>
    </div>
  );
}

function TicketCard({ ticket, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.6 : 1 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="ticket"
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
      <div className="ticket-tags">
        <span className={`type-badge ${TYPE_META[ticket.type].className}`}>
          {TYPE_META[ticket.type].icon} {TYPE_META[ticket.type].label}
        </span>
        {ticket.epic && <span className="ticket-epic">📚 {ticket.epic.title}</span>}
      </div>
      <div className="ticket-title">{ticket.title}</div>
      {ticket.assignee && <div className="ticket-assignee">👤 {ticket.assignee.name}</div>}
    </div>
  );
}

function TicketModal({
  teamId,
  teams,
  members,
  epics,
  ticket,
  onClose,
  onSaved,
  onDeleted,
}: {
  teamId: string;
  teams: Team[];
  members: Member[];
  epics: Epic[];
  ticket?: Ticket;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [type, setType] = useState<TicketType>(ticket?.type ?? "FEATURE");
  const [assigneeId, setAssigneeId] = useState(ticket?.assignee?.id ?? "");
  const [epicId, setEpicId] = useState(ticket?.epic?.id ?? "");
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? "NEW");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isEdit = !!ticket;

  // Team can be changed while editing. Assignees and epics are team-scoped,
  // so switching teams reloads both lists and clears the old selections.
  const [selectedTeamId, setSelectedTeamId] = useState(ticket?.teamId ?? teamId);
  const [modalMembers, setModalMembers] = useState<Member[]>(members);
  const [modalEpics, setModalEpics] = useState<Epic[]>(epics);

  const onTeamChange = async (newTeamId: string) => {
    setSelectedTeamId(newTeamId);
    setAssigneeId("");
    setEpicId("");
    setError("");
    try {
      const [m, e] = await Promise.all([api.listMembers(newTeamId), api.listEpics(newTeamId)]);
      setModalMembers(m.members);
      setModalEpics(e.epics);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isEdit) {
        await api.updateTicket(ticket!.id, {
          teamId: selectedTeamId,
          title: title.trim(),
          description,
          type,
          assigneeId: assigneeId || null,
          epicId: epicId || null,
          status,
        });
      } else {
        await api.createTicket({
          teamId,
          title: title.trim(),
          description,
          type,
          assigneeId: assigneeId || null,
          epicId: epicId || null,
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!ticket || !confirm("Delete this ticket?")) return;
    setBusy(true);
    try {
      await api.deleteTicket(ticket.id);
      onDeleted?.();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{isEdit ? "Edit ticket" : "New ticket"}</h2>
        {error && <div className="alert">{error}</div>}
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as TicketType)}>
            {(Object.keys(TYPE_META) as TicketType[]).map((t) => (
              <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label}</option>
            ))}
          </select>
        </label>
        {isEdit && (
          <label>
            Team
            <select value={selectedTeamId} onChange={(e) => onTeamChange(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Assignee
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {modalMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label>
          Epic
          <select value={epicId} onChange={(e) => setEpicId(e.target.value)}>
            <option value="">No epic</option>
            {modalEpics.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.title}</option>
            ))}
          </select>
        </label>
        {isEdit && (
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          {isEdit && (
            <button type="button" className="danger" onClick={remove} disabled={busy}>Delete</button>
          )}
          <div className="spacer" />
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/maintenance"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/repository"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/service"
)

type Handlers struct {
	Tickets *service.TicketService
	Times   *service.TimeEntryService
	Cal     *service.CalendarService
	Repos   *service.RepositoryService
	Maint   *maintenance.Mode
}

func (h *Handlers) Mount(r chi.Router) {
	r.Get("/api/health", h.health)

	r.Route("/api/tickets", func(r chi.Router) {
		r.Get("/", h.listTickets)
		r.Post("/", h.createTicket)
		r.Get("/{id}", h.getTicket)
		r.Put("/{id}", h.updateTicket)
		r.Delete("/{id}", h.deleteTicket)
		r.Post("/{id}/tags", h.addTag)
		r.Delete("/{id}/tags", h.removeTag)
	})

	r.Get("/api/tags", h.listTags)

	r.Route("/api/time-entries", func(r chi.Router) {
		r.Get("/", h.listTimeEntries)
		r.Post("/", h.createTimeEntry)
		r.Put("/{id}", h.updateTimeEntry)
		r.Delete("/{id}", h.deleteTimeEntry)
	})

	r.Route("/api/calendar", func(r chi.Router) {
		r.Get("/", h.calendarRange)
		r.Get("/events", h.listEvents)
		r.Post("/events", h.createEvent)
		r.Put("/events/{id}", h.updateEvent)
		r.Delete("/events/{id}", h.deleteEvent)
	})

	r.Route("/api/repositories", func(r chi.Router) {
		r.Get("/", h.listRepos)
		r.Post("/", h.createRepo)
		r.Delete("/{id}", h.deleteRepo)
		r.Get("/{id}/branches", h.listBranches)
		r.Post("/{id}/branches", h.createBranch)
	})

	r.Route("/api/maintenance", func(r chi.Router) {
		r.Get("/status", h.maintStatus)
		r.Post("/enable", h.maintEnable)
		r.Post("/disable", h.maintDisable)
		r.Get("/tables", h.maintTables)
		r.Get("/tables/{name}", h.maintDump)
		r.Post("/query", h.maintQuery)
	})
}

func (h *Handlers) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"maintenance": h.Maint.Enabled(),
	})
}

// --- tickets ---

func (h *Handlers) listTickets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := repository.TicketFilter{
		Type:   q.Get("type"),
		Status: q.Get("status"),
		Tag:    q.Get("tag"),
	}
	if q.Has("parent_id") {
		v := q.Get("parent_id")
		f.ParentID = &v
	}
	out, err := h.Tickets.List(r.Context(), f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type ticketCreateReq struct {
	ParentID      *string  `json:"parent_id"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Type          string   `json:"type"`
	Status        string   `json:"status"`
	Assignee      *string  `json:"assignee"`
	EstimateHours *float64 `json:"estimate_hours"`
	DueDate       *string  `json:"due_date"`
	RepositoryID  *string  `json:"repository_id"`
	Branch        *string  `json:"branch"`
	Tags          []string `json:"tags"`
}

func (h *Handlers) createTicket(w http.ResponseWriter, r *http.Request) {
	var req ticketCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	t := &domain.Ticket{
		ParentID:      req.ParentID,
		Title:         req.Title,
		Description:   req.Description,
		Type:          domain.TicketType(req.Type),
		Status:        domain.TicketStatus(req.Status),
		Assignee:      req.Assignee,
		EstimateHours: req.EstimateHours,
		DueDate:       req.DueDate,
		RepositoryID:  req.RepositoryID,
		Branch:        req.Branch,
	}
	if err := h.Tickets.Create(r.Context(), t, req.Tags); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	out, err := h.Tickets.Get(r.Context(), t.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (h *Handlers) getTicket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	t, err := h.Tickets.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *Handlers) updateTicket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	current, err := h.Tickets.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	var req ticketCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	current.ParentID = req.ParentID
	if req.Title != "" {
		current.Title = req.Title
	}
	current.Description = req.Description
	if req.Type != "" {
		current.Type = domain.TicketType(req.Type)
	}
	if req.Status != "" {
		current.Status = domain.TicketStatus(req.Status)
	}
	current.Assignee = req.Assignee
	current.EstimateHours = req.EstimateHours
	current.DueDate = req.DueDate
	current.RepositoryID = req.RepositoryID
	current.Branch = req.Branch
	if err := h.Tickets.Update(r.Context(), current); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	out, _ := h.Tickets.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) deleteTicket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Tickets.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) addTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Tag string `json:"tag"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := h.Tickets.AddTag(r.Context(), id, req.Tag); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) removeTag(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag := r.URL.Query().Get("tag")
	if err := h.Tickets.RemoveTag(r.Context(), id, tag); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) listTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.Tickets.ListTags(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

// --- time entries ---

func (h *Handlers) listTimeEntries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := repository.TimeEntryFilter{
		TicketID: q.Get("ticket_id"),
		From:     q.Get("from"),
		To:       q.Get("to"),
	}
	out, err := h.Times.List(r.Context(), f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) createTimeEntry(w http.ResponseWriter, r *http.Request) {
	var e domain.TimeEntry
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := h.Times.Create(r.Context(), &e); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

func (h *Handlers) updateTimeEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var e domain.TimeEntry
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	e.ID = id
	if err := h.Times.Update(r.Context(), &e); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	out, err := h.Times.Get(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) deleteTimeEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Times.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- calendar ---

func (h *Handlers) calendarRange(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	out, err := h.Cal.Range(r.Context(), from, to)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) listEvents(w http.ResponseWriter, r *http.Request) {
	out, err := h.Cal.ListEvents(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) createEvent(w http.ResponseWriter, r *http.Request) {
	var e domain.CalendarEvent
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := h.Cal.CreateEvent(r.Context(), &e); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

func (h *Handlers) updateEvent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var e domain.CalendarEvent
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	e.ID = id
	if err := h.Cal.UpdateEvent(r.Context(), &e); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	out, err := h.Cal.GetEvent(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) deleteEvent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Cal.DeleteEvent(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- repositories ---

func (h *Handlers) listRepos(w http.ResponseWriter, r *http.Request) {
	out, err := h.Repos.List(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) createRepo(w http.ResponseWriter, r *http.Request) {
	var rep domain.Repository
	if err := json.NewDecoder(r.Body).Decode(&rep); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := h.Repos.Create(r.Context(), &rep); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, rep)
}

func (h *Handlers) deleteRepo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Repos.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) listBranches(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	out, err := h.Repos.ListBranches(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) createBranch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Branch   string `json:"branch"`
		From     string `json:"from"`
		Checkout bool   `json:"checkout"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	br, err := h.Repos.CreateBranch(r.Context(), id, req.Branch, req.From, req.Checkout)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"branch": br})
}

// --- maintenance ---

func (h *Handlers) maintStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": h.Maint.Enabled()})
}

func (h *Handlers) maintEnable(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if err := h.Maint.Enable(req.Token); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": true})
}

func (h *Handlers) maintDisable(w http.ResponseWriter, r *http.Request) {
	h.Maint.Disable()
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": false})
}

func (h *Handlers) maintTables(w http.ResponseWriter, r *http.Request) {
	out, err := h.Maint.Tables(r.Context())
	if err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) maintDump(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	out, err := h.Maint.DumpTable(r.Context(), name, limit)
	if err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) maintQuery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SQL string `json:"sql"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	out, err := h.Maint.Query(r.Context(), req.SQL)
	if err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// helpers

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

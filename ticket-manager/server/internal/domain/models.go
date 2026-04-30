package domain

import "time"

type TicketType string

const (
	TicketTypeEpic    TicketType = "EPIC"
	TicketTypeStory   TicketType = "STORY"
	TicketTypeTask    TicketType = "TASK"
	TicketTypeSubtask TicketType = "SUBTASK"
)

func (t TicketType) Valid() bool {
	switch t {
	case TicketTypeEpic, TicketTypeStory, TicketTypeTask, TicketTypeSubtask:
		return true
	}
	return false
}

type TicketStatus string

const (
	TicketStatusTodo       TicketStatus = "TODO"
	TicketStatusInProgress TicketStatus = "IN_PROGRESS"
	TicketStatusDone       TicketStatus = "DONE"
)

func (s TicketStatus) Valid() bool {
	switch s {
	case TicketStatusTodo, TicketStatusInProgress, TicketStatusDone:
		return true
	}
	return false
}

type Ticket struct {
	ID            string       `json:"id"`
	ParentID      *string      `json:"parent_id"`
	Title         string       `json:"title"`
	Description   string       `json:"description"`
	Type          TicketType   `json:"type"`
	Status        TicketStatus `json:"status"`
	Assignee      *string      `json:"assignee"`
	EstimateHours *float64     `json:"estimate_hours"`
	DueDate       *string      `json:"due_date"`
	RepositoryID  *string      `json:"repository_id"`
	Branch        *string      `json:"branch"`
	Tags          []string     `json:"tags"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

type Tag struct {
	Name       string `json:"name"`
	UsageCount int    `json:"usage_count"`
}

type TimeEntry struct {
	ID          string     `json:"id"`
	TicketID    string     `json:"ticket_id"`
	TicketTitle string     `json:"ticket_title,omitempty"`
	User        string     `json:"user"`
	Hours       float64    `json:"hours"`
	WorkDate    string     `json:"work_date"`
	StartAt     *time.Time `json:"start_at,omitempty"`
	EndAt       *time.Time `json:"end_at,omitempty"`
	Note        string     `json:"note"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CalendarEvent struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	StartDate   string     `json:"start_date"`
	EndDate     *string    `json:"end_date"`
	StartAt     *time.Time `json:"start_at,omitempty"`
	EndAt       *time.Time `json:"end_at,omitempty"`
	TicketID    *string    `json:"ticket_id,omitempty"`
	TicketTitle *string    `json:"ticket_title,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CalendarItem struct {
	Kind     string     `json:"kind"`
	Date     string     `json:"date"`
	Title    string     `json:"title"`
	TicketID *string    `json:"ticket_id,omitempty"`
	Hours    *float64   `json:"hours,omitempty"`
	Status   *string    `json:"status,omitempty"`
	EventID  *string    `json:"event_id,omitempty"`
	StartAt  *time.Time `json:"start_at,omitempty"`
	EndAt    *time.Time `json:"end_at,omitempty"`
}

type Repository struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Path          string    `json:"path"`
	DefaultBranch string    `json:"default_branch"`
	CreatedAt     time.Time `json:"created_at"`
}
